-- Les politiques publiques d'origine joignaient directement offres_organisations.
-- Le role anon n'a volontairement aucun SELECT sur cette table interne : la
-- verification passe donc par le predicat prive, sans exposer les details d'offre.

grant execute on function private.est_white_label(uuid) to anon, authenticated;

drop policy if exists configurations_boutique_publiques
  on public.configurations_boutique;
create policy configurations_boutique_publiques
on public.configurations_boutique
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.boutiques b
    where b.id = configurations_boutique.boutique_id
      and b.statut = 'PUBLIEE'
      and b.mode_vitrine = 'WHITE_LABEL'
      and (select private.est_white_label(b.organisation_id))
  )
);

drop policy if exists categories_boutique_publiques
  on public.categories_boutique;
create policy categories_boutique_publiques
on public.categories_boutique
for select
to anon, authenticated
using (
  actif
  and exists (
    select 1
    from public.boutiques b
    where b.id = categories_boutique.boutique_id
      and b.statut = 'PUBLIEE'
      and b.mode_vitrine = 'WHITE_LABEL'
      and (select private.est_white_label(b.organisation_id))
  )
);
