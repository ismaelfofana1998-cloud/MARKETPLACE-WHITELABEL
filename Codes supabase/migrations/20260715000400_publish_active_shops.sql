-- IKIGAI Market - publier une boutique quand son catalogue devient actif.

set search_path = public, extensions;

create or replace function private.publier_boutique_produit_actif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.boutiques
  set statut = 'PUBLIEE', modifie_le = now()
  where id = new.boutique_id
    and statut = 'BROUILLON';
  return new;
end;
$$;

revoke all on function private.publier_boutique_produit_actif()
from public, anon, authenticated;

drop trigger if exists publier_boutique_produit_actif on public.produits;
create trigger publier_boutique_produit_actif
after insert on public.produits
for each row
when (new.statut = 'ACTIF')
execute function private.publier_boutique_produit_actif();

-- Corriger les boutiques deja alimentees avant l'ajout de cette automatisation.
update public.boutiques b
set statut = 'PUBLIEE', modifie_le = now()
where b.statut = 'BROUILLON'
  and exists (
    select 1
    from public.produits p
    where p.boutique_id = b.id
      and p.statut = 'ACTIF'
  );
