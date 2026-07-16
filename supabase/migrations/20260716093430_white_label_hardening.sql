-- Correctifs detectes par les tests transactionnels White Label.

create or replace function private.valider_capacite_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offre public.offres_organisations%rowtype;
  v_nombre integer;
begin
  new.code_etablissement := coalesce(nullif(trim(new.code_etablissement), ''), new.slug);

  select * into v_offre
  from public.offres_organisations
  where organisation_id = new.organisation_id and active;

  if v_offre.organisation_id is null then
    raise exception 'Aucune offre active pour cette organisation.' using errcode = '23514';
  end if;
  if new.mode_vitrine = 'WHITE_LABEL'
     and (v_offre.offre <> 'WHITE_LABEL' or not v_offre.white_label_actif) then
    raise exception 'L''offre Site dedie est requise.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.organisation_id is distinct from old.organisation_id then
    select count(*) into v_nombre
    from public.boutiques
    where organisation_id = new.organisation_id;
    if v_nombre >= v_offre.max_etablissements then
      raise exception 'Le nombre maximal d''etablissements de cette offre est atteint.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.valider_capacite_boutique() from public, anon, authenticated;
