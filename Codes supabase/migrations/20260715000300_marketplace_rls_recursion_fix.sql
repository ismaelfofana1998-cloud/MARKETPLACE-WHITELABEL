-- IKIGAI Market - supprimer les cycles RLS entre achats et commandes.

set search_path = public, extensions;

create or replace function private.est_acheteur_achat(p_achat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.achats a
    where a.id = p_achat_id
      and a.acheteur_id = (select auth.uid())
  );
$$;

create or replace function private.peut_lire_achat_marchand(p_achat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.commandes_marketplace c
    where c.achat_id = p_achat_id
      and private.peut_operer_boutique(c.boutique_id)
  );
$$;

create or replace function private.peut_lire_adresse_marchand(p_adresse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.achats a
    join public.commandes_marketplace c on c.achat_id = a.id
    where a.adresse_livraison_id = p_adresse_id
      and private.peut_operer_boutique(c.boutique_id)
  );
$$;

create or replace function private.peut_lire_commande(p_commande_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.commandes_marketplace c
    join public.achats a on a.id = c.achat_id
    where c.id = p_commande_id
      and (
        a.acheteur_id = (select auth.uid())
        or private.peut_operer_boutique(c.boutique_id)
      )
  );
$$;

create or replace function private.peut_ajouter_avis_produit(p_produit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.lignes_commande_marketplace l
    join public.commandes_marketplace c on c.id = l.commande_id
    join public.achats a on a.id = c.achat_id
    where l.produit_id = p_produit_id
      and a.acheteur_id = (select auth.uid())
      and c.statut = 'LIVREE'
  );
$$;

revoke all on function private.est_acheteur_achat(uuid) from public, anon;
revoke all on function private.peut_lire_achat_marchand(uuid) from public, anon;
revoke all on function private.peut_lire_adresse_marchand(uuid) from public, anon;
revoke all on function private.peut_lire_commande(uuid) from public, anon;
revoke all on function private.peut_ajouter_avis_produit(uuid) from public, anon;

grant execute on function private.est_acheteur_achat(uuid) to authenticated;
grant execute on function private.peut_lire_achat_marchand(uuid) to authenticated;
grant execute on function private.peut_lire_adresse_marchand(uuid) to authenticated;
grant execute on function private.peut_lire_commande(uuid) to authenticated;
grant execute on function private.peut_ajouter_avis_produit(uuid) to authenticated;

drop policy if exists achats_marchand_lecture on public.achats;
create policy achats_marchand_lecture
on public.achats for select to authenticated
using ((select private.peut_lire_achat_marchand(id)));

drop policy if exists commandes_acheteur on public.commandes_marketplace;
create policy commandes_acheteur
on public.commandes_marketplace for select to authenticated
using ((select private.est_acheteur_achat(achat_id)));

drop policy if exists adresses_lecture_marchand on public.adresses_livraison;
create policy adresses_lecture_marchand
on public.adresses_livraison for select to authenticated
using (
  identite_id = (select auth.uid())
  or (select private.peut_lire_adresse_marchand(id))
);

drop policy if exists historique_acheteur_marchand on public.historique_statuts_commande;
create policy historique_acheteur_marchand
on public.historique_statuts_commande for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists lignes_commande_acheteur_marchand on public.lignes_commande_marketplace;
create policy lignes_commande_acheteur_marchand
on public.lignes_commande_marketplace for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists missions_acheteur_marchand on public.missions_logistiques;
create policy missions_acheteur_marchand
on public.missions_logistiques for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists paiements_acheteur on public.paiements_marketplace;
create policy paiements_acheteur
on public.paiements_marketplace for select to authenticated
using ((select private.est_acheteur_achat(achat_id)));

drop policy if exists avis_creation_acheteur on public.avis_produits;
create policy avis_creation_acheteur
on public.avis_produits for insert to authenticated
with check (
  identite_id = (select auth.uid())
  and (select private.peut_ajouter_avis_produit(produit_id))
);
