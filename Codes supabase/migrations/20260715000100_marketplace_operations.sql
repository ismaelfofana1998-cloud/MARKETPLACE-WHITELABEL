-- IKIGAI Market - mise a niveau operationnelle.
-- Cette migration est idempotente et peut etre collee telle quelle dans
-- l'editeur SQL Supabase apres les migrations 20260711000100 a 00400.

set search_path = public, extensions;

alter table public.categories_marketplace
  add column if not exists description text;

alter table public.boutiques
  add column if not exists email_contact text,
  add column if not exists whatsapp text,
  add column if not exists delai_preparation_minutes integer not null default 60,
  add column if not exists horaires jsonb not null default '{}'::jsonb;

alter table public.produits
  add column if not exists marque text,
  add column if not exists tags text[] not null default '{}';

alter table public.commandes_marketplace
  add column if not exists vue_le timestamptz,
  add column if not exists annulee_par uuid references public.identites(id) on delete set null,
  add column if not exists motif_annulation text;

create table if not exists public.configuration_marketplace (
  id smallint primary key default 1 check (id = 1),
  nom text not null default 'IKIGAI Market',
  slogan text not null default 'Les boutiques d''ici, livrees par IKIGAI.',
  description text not null default 'Achetez aupres de commerces locaux et suivez chaque livraison.',
  logo_url text,
  hero_image_url text not null default 'https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=1800&q=86',
  couleur_primaire text not null default '#C75332' check (couleur_primaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_secondaire text not null default '#17211F' check (couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_accent text not null default '#E9AE36' check (couleur_accent ~ '^#[0-9A-Fa-f]{6}$'),
  email_support text,
  telephone_support text,
  modifie_le timestamptz not null default now()
);

insert into public.configuration_marketplace (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.favoris_marketplace (
  identite_id uuid not null references public.identites(id) on delete cascade,
  produit_id uuid not null references public.produits(id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (identite_id, produit_id)
);

create table if not exists public.historique_statuts_commande (
  id bigint generated always as identity primary key,
  commande_id uuid not null references public.commandes_marketplace(id) on delete cascade,
  ancien_statut text,
  nouveau_statut text not null,
  change_par uuid references public.identites(id) on delete set null,
  note text,
  cree_le timestamptz not null default now()
);

create index if not exists favoris_produit_idx
  on public.favoris_marketplace(produit_id);
create index if not exists historique_commande_date_idx
  on public.historique_statuts_commande(commande_id, cree_le desc);

drop trigger if exists configuration_marketplace_toucher_modification on public.configuration_marketplace;
create trigger configuration_marketplace_toucher_modification
before update on public.configuration_marketplace
for each row execute function private.toucher_modification();

create or replace function private.peut_operer_boutique(p_boutique_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.boutiques b
    where b.id = p_boutique_id
      and private.est_membre_organisation(
        b.organisation_id,
        array['PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE', 'AGENT']
      )
  );
$$;

revoke all on function private.peut_operer_boutique(uuid)
from public, anon, authenticated;

-- Les helpers restent hors des schemas exposes par PostgREST. Le role
-- authenticated doit toutefois pouvoir les invoquer pendant l'evaluation RLS.
grant usage on schema private to authenticated;
grant execute on function private.est_membre_organisation(uuid, text[]) to authenticated;
grant execute on function private.est_admin_plateforme(text[]) to authenticated;
grant execute on function private.peut_gerer_boutique(uuid) to authenticated;
grant execute on function private.peut_operer_boutique(uuid) to authenticated;

create or replace function private.journaliser_statut_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.statut is distinct from new.statut then
    insert into public.historique_statuts_commande
      (commande_id, ancien_statut, nouveau_statut, change_par, note)
    values
      (new.id, case when tg_op = 'INSERT' then null else old.statut end,
       new.statut, (select auth.uid()), new.motif_annulation);
  end if;
  return new;
end;
$$;

drop trigger if exists commandes_marketplace_historique on public.commandes_marketplace;
create trigger commandes_marketplace_historique
after insert or update of statut on public.commandes_marketplace
for each row execute function private.journaliser_statut_commande();

create or replace function private.synchroniser_commande_annulee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_frais bigint;
begin
  if old.statut is distinct from 'ANNULEE' and new.statut = 'ANNULEE' then
    update public.stocks s
    set quantite = s.quantite + lignes.quantite,
        modifie_le = now()
    from (
      select variante_id, sum(quantite)::integer as quantite
      from public.lignes_commande_marketplace
      where commande_id = new.id
      group by variante_id
    ) lignes
    where s.variante_id = lignes.variante_id;
  end if;

  select coalesce(sum(sous_total), 0), coalesce(sum(frais_livraison), 0)
  into v_total, v_frais
  from public.commandes_marketplace
  where achat_id = new.achat_id and statut <> 'ANNULEE';

  update public.achats
  set sous_total = v_total,
      frais_livraison = v_frais,
      total = v_total + v_frais,
      statut_paiement = case
        when v_total + v_frais = 0 then 'ECHOUE'
        when mode_paiement = 'A_LA_LIVRAISON'
             and not exists (
               select 1 from public.commandes_marketplace
               where achat_id = new.achat_id and statut not in ('LIVREE', 'ANNULEE')
             ) then 'PAYE'
        else statut_paiement
      end
  where id = new.achat_id;

  update public.paiements_marketplace p
  set montant = v_total + v_frais,
      statut = case
        when v_total + v_frais = 0 then 'ECHOUE'
        when exists (
          select 1 from public.achats a
          where a.id = new.achat_id and a.statut_paiement = 'PAYE'
        ) then 'CONFIRME'
        else p.statut
      end,
      confirme_le = case
        when exists (
          select 1 from public.achats a
          where a.id = new.achat_id and a.statut_paiement = 'PAYE'
        ) then coalesce(p.confirme_le, now())
        else p.confirme_le
      end
  where p.achat_id = new.achat_id;

  return new;
end;
$$;

drop trigger if exists commandes_marketplace_synchroniser on public.commandes_marketplace;
create trigger commandes_marketplace_synchroniser
after update of statut on public.commandes_marketplace
for each row execute function private.synchroniser_commande_annulee();

insert into public.historique_statuts_commande
  (commande_id, ancien_statut, nouveau_statut, change_par, cree_le)
select c.id, null, c.statut, null, c.cree_le
from public.commandes_marketplace c
where not exists (
  select 1 from public.historique_statuts_commande h where h.commande_id = c.id
);

create or replace function public.rpc_reclamer_super_admin()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
begin
  if v_utilisateur is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  lock table public.administrateurs_plateforme in share row exclusive mode;
  if exists (select 1 from public.administrateurs_plateforme where actif) then
    raise exception 'La plateforme possede deja un administrateur.' using errcode = '42501';
  end if;

  insert into public.administrateurs_plateforme (identite_id, role, actif)
  values (v_utilisateur, 'SUPER_ADMIN', true)
  on conflict (identite_id)
  do update set role = 'SUPER_ADMIN', actif = true;
  return 'SUPER_ADMIN';
end;
$$;

create or replace function public.rpc_inviter_membre(
  p_organisation_id uuid,
  p_email text,
  p_role text default 'MEMBRE'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_invitation uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN'])
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur requis.' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'GESTIONNAIRE', 'AGENT', 'MEMBRE') then
    raise exception 'Role invalide.';
  end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) < 2 then
    raise exception 'Adresse email invalide.';
  end if;

  update public.invitations_organisation
  set statut = 'ANNULEE'
  where organisation_id = p_organisation_id
    and lower(email::text) = lower(trim(p_email))
    and statut = 'EN_ATTENTE';

  insert into public.invitations_organisation
    (organisation_id, email, role, token, invite_par)
  values
    (p_organisation_id, lower(trim(p_email)), p_role, v_token, (select auth.uid()))
  returning id into v_invitation;

  return jsonb_build_object('id', v_invitation, 'token', v_token);
end;
$$;

create or replace function public.rpc_admin_creer_tenant(
  p_nom text,
  p_slug text,
  p_type text,
  p_email_proprietaire text,
  p_creer_boutique boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_organisation uuid;
  v_boutique uuid;
  v_token uuid := gen_random_uuid();
begin
  if v_admin is null or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if p_type not in ('LOGISTIQUE', 'PRESSING', 'MARCHAND', 'RESTAURANT', 'AUTRE') then
    raise exception 'Type d''organisation invalide.';
  end if;
  if nullif(trim(p_email_proprietaire), '') is null or position('@' in p_email_proprietaire) < 2 then
    raise exception 'Adresse email invalide.';
  end if;

  insert into public.organisations (nom, slug, type, cree_par)
  values (trim(p_nom), lower(trim(p_slug)), p_type, v_admin)
  returning id into v_organisation;

  insert into public.invitations_organisation
    (organisation_id, email, role, token, invite_par)
  values
    (v_organisation, lower(trim(p_email_proprietaire)), 'ADMIN', v_token, v_admin);

  if p_creer_boutique and p_type in ('MARCHAND', 'RESTAURANT') then
    insert into public.boutiques (organisation_id, nom, slug)
    values (v_organisation, trim(p_nom), lower(trim(p_slug)))
    returning id into v_boutique;
  end if;

  return jsonb_build_object(
    'organisation_id', v_organisation,
    'boutique_id', v_boutique,
    'token', v_token
  );
end;
$$;

create or replace function public.rpc_enregistrer_produit_marketplace(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_produit_id uuid default null,
  p_categorie_id uuid default null,
  p_description text default null,
  p_marque text default null,
  p_images text[] default '{}',
  p_statut text default 'ACTIF'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
  v_variante uuid;
  v_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.peut_gerer_boutique(p_boutique_id) then
    raise exception 'Droit gestionnaire requis.' using errcode = '42501';
  end if;
  if nullif(trim(p_nom), '') is null or p_prix < 0 or p_stock < 0 then
    raise exception 'Nom, prix ou stock invalide.';
  end if;
  if p_statut not in ('BROUILLON', 'ACTIF', 'EPUISE', 'ARCHIVE') then
    raise exception 'Statut invalide.';
  end if;

  if p_produit_id is null then
    v_slug := trim(both '-' from lower(regexp_replace(trim(p_nom), '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    insert into public.produits
      (boutique_id, categorie_id, nom, slug, description, marque, prix, images, statut)
    values
      (p_boutique_id, p_categorie_id, trim(p_nom), v_slug,
       nullif(trim(p_description), ''), nullif(trim(p_marque), ''), p_prix,
       coalesce(p_images, '{}'), p_statut)
    returning id into v_produit;

    insert into public.variantes_produit (produit_id, sku, nom)
    values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
    returning id into v_variante;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock);
  else
    select id into v_produit
    from public.produits
    where id = p_produit_id and boutique_id = p_boutique_id
    for update;
    if v_produit is null then
      raise exception 'Produit inaccessible.' using errcode = '42501';
    end if;

    update public.produits
    set categorie_id = p_categorie_id,
        nom = trim(p_nom),
        description = nullif(trim(p_description), ''),
        marque = nullif(trim(p_marque), ''),
        prix = p_prix,
        images = coalesce(p_images, '{}'),
        statut = p_statut
    where id = v_produit;

    select id into v_variante
    from public.variantes_produit
    where produit_id = v_produit
    order by cree_le
    limit 1;
    if v_variante is null then
      insert into public.variantes_produit (produit_id, sku, nom)
      values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
      returning id into v_variante;
    end if;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock)
    on conflict (variante_id)
    do update set quantite = excluded.quantite, modifie_le = now();
  end if;
  return v_produit;
end;
$$;

create or replace function public.rpc_changer_statut_commande_marketplace(
  p_commande_id uuid,
  p_nouveau_statut text,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande public.commandes_marketplace%rowtype;
  v_autorise boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select * into v_commande
  from public.commandes_marketplace
  where id = p_commande_id
  for update;
  if v_commande.id is null or not private.peut_operer_boutique(v_commande.boutique_id) then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;

  v_autorise := case v_commande.statut
    when 'NOUVELLE' then p_nouveau_statut in ('CONFIRMEE', 'ANNULEE')
    when 'CONFIRMEE' then p_nouveau_statut in ('EN_PREPARATION', 'ANNULEE')
    when 'EN_PREPARATION' then p_nouveau_statut in ('PRETE', 'ANNULEE')
    when 'PRETE' then p_nouveau_statut in ('EN_LIVRAISON', 'ANNULEE')
    when 'EN_LIVRAISON' then p_nouveau_statut = 'LIVREE'
    else false
  end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  update public.commandes_marketplace
  set statut = p_nouveau_statut,
      annulee_par = case when p_nouveau_statut = 'ANNULEE' then (select auth.uid()) else annulee_par end,
      motif_annulation = case when p_nouveau_statut = 'ANNULEE' then nullif(trim(p_motif), '') else motif_annulation end,
      vue_le = coalesce(vue_le, now())
  where id = p_commande_id;
end;
$$;

create or replace function public.rpc_annuler_commande_client(
  p_commande_id uuid,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select c.statut into v_statut
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = p_commande_id and a.acheteur_id = (select auth.uid())
  for update of c;
  if v_statut is null then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;
  if v_statut not in ('NOUVELLE', 'CONFIRMEE') then
    raise exception 'Cette commande est deja en preparation.';
  end if;
  update public.commandes_marketplace
  set statut = 'ANNULEE', annulee_par = (select auth.uid()),
      motif_annulation = nullif(trim(p_motif), '')
  where id = p_commande_id;
end;
$$;

revoke all on function public.rpc_reclamer_super_admin() from public, anon;
revoke all on function public.rpc_inviter_membre(uuid, text, text) from public, anon;
revoke all on function public.rpc_admin_creer_tenant(text, text, text, text, boolean) from public, anon;
revoke all on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text, text) from public, anon;
revoke all on function public.rpc_annuler_commande_client(uuid, text) from public, anon;

grant execute on function public.rpc_reclamer_super_admin() to authenticated;
grant execute on function public.rpc_inviter_membre(uuid, text, text) to authenticated;
grant execute on function public.rpc_admin_creer_tenant(text, text, text, text, boolean) to authenticated;
grant execute on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text, text) to authenticated;
grant execute on function public.rpc_annuler_commande_client(uuid, text) to authenticated;

alter table public.configuration_marketplace enable row level security;
alter table public.favoris_marketplace enable row level security;
alter table public.historique_statuts_commande enable row level security;

drop policy if exists configuration_marketplace_lecture on public.configuration_marketplace;
create policy configuration_marketplace_lecture
on public.configuration_marketplace for select to anon, authenticated
using (true);

drop policy if exists configuration_marketplace_admin on public.configuration_marketplace;
create policy configuration_marketplace_admin
on public.configuration_marketplace for update to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN'])));

drop policy if exists favoris_proprietaire on public.favoris_marketplace;
create policy favoris_proprietaire
on public.favoris_marketplace for all to authenticated
using (identite_id = (select auth.uid()))
with check (identite_id = (select auth.uid()));

drop policy if exists historique_acheteur_marchand on public.historique_statuts_commande;
create policy historique_acheteur_marchand
on public.historique_statuts_commande for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = commande_id
    and (a.acheteur_id = (select auth.uid()) or private.peut_operer_boutique(c.boutique_id))
));

drop policy if exists historique_admin on public.historique_statuts_commande;
create policy historique_admin
on public.historique_statuts_commande for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists identites_admin_lecture on public.identites;
create policy identites_admin_lecture on public.identites for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists organisations_admin_lecture on public.organisations;
create policy organisations_admin_lecture on public.organisations for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists boutiques_operateurs_lecture on public.boutiques;
create policy boutiques_operateurs_lecture on public.boutiques for select to authenticated
using ((select private.peut_operer_boutique(id)));

drop policy if exists membres_admin_lecture on public.membres_organisation;
create policy membres_admin_lecture on public.membres_organisation for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists invitations_admin_lecture on public.invitations_organisation;
create policy invitations_admin_lecture on public.invitations_organisation for select to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])));

drop policy if exists administrateurs_lecture_super on public.administrateurs_plateforme;
create policy administrateurs_lecture_super on public.administrateurs_plateforme for select to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN'])));

drop policy if exists adresses_lecture_marchand on public.adresses_livraison;
create policy adresses_lecture_marchand on public.adresses_livraison for select to authenticated
using (
  identite_id = (select auth.uid())
  or exists (
    select 1
    from public.achats a
    join public.commandes_marketplace c on c.achat_id = a.id
    where a.adresse_livraison_id = adresses_livraison.id
      and private.peut_operer_boutique(c.boutique_id)
  )
);

drop policy if exists achats_admin_lecture on public.achats;
create policy achats_admin_lecture on public.achats for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists achats_marchand_lecture on public.achats;
create policy achats_marchand_lecture on public.achats for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  where c.achat_id = achats.id
    and private.peut_operer_boutique(c.boutique_id)
));

drop policy if exists commandes_marchand on public.commandes_marketplace;
create policy commandes_marchand on public.commandes_marketplace for select to authenticated
using ((select private.peut_operer_boutique(boutique_id)));

drop policy if exists commandes_admin_lecture on public.commandes_marketplace;
create policy commandes_admin_lecture on public.commandes_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists lignes_commande_acheteur_marchand on public.lignes_commande_marketplace;
create policy lignes_commande_acheteur_marchand on public.lignes_commande_marketplace for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = commande_id
    and (a.acheteur_id = (select auth.uid()) or private.peut_operer_boutique(c.boutique_id))
));

drop policy if exists lignes_commande_admin_lecture on public.lignes_commande_marketplace;
create policy lignes_commande_admin_lecture on public.lignes_commande_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists paiements_admin_lecture on public.paiements_marketplace;
create policy paiements_admin_lecture on public.paiements_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

grant select on public.configuration_marketplace to anon;
grant select, update on public.configuration_marketplace to authenticated;
grant select, insert, delete on public.favoris_marketplace to authenticated;
grant select on public.historique_statuts_commande to authenticated;

drop policy if exists marketplace_medias_admin_creation on storage.objects;
create policy marketplace_medias_admin_creation on storage.objects
for insert to authenticated
with check (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

drop policy if exists marketplace_medias_admin_modification on storage.objects;
create policy marketplace_medias_admin_modification on storage.objects
for update to authenticated
using (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])))
with check (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

drop policy if exists marketplace_medias_admin_suppression on storage.objects;
create policy marketplace_medias_admin_suppression on storage.objects
for delete to authenticated
using (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

insert into public.categories_marketplace (nom, slug, description, image_url, ordre)
values
  ('Mode', 'mode', 'Vetements, chaussures et accessoires', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=82', 10),
  ('Maison', 'maison', 'Decoration, mobilier et quotidien', 'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&w=700&q=82', 20),
  ('Beaute', 'beaute', 'Cosmetiques, soins et bien-etre', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=700&q=82', 30),
  ('Epicerie', 'epicerie', 'Produits frais et alimentation', 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=82', 40),
  ('High-tech', 'high-tech', 'Telephones, informatique et accessoires', 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=700&q=82', 50),
  ('Enfants', 'enfants', 'Jeux, mode et essentiels pour enfants', 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?auto=format&fit=crop&w=700&q=82', 60)
on conflict (slug) do update set
  nom = excluded.nom,
  description = excluded.description,
  image_url = excluded.image_url,
  ordre = excluded.ordre,
  actif = true;

alter table public.commandes_marketplace replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'commandes_marketplace'
  ) then
    alter publication supabase_realtime add table public.commandes_marketplace;
  end if;
end;
$$;
