set search_path = public, extensions;

alter table if exists public.integrations_ikms_boutique
  alter column mode_paiement set default 'A_LA_LIVRAISON';

create or replace function public.rpc_configurer_integration_ikms_boutique(
  p_boutique_id uuid,
  p_zone_depart text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_mode_paiement text default 'A_LA_LIVRAISON',
  p_api_key text default null,
  p_actif boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.configuration_marketplace%rowtype;
  v_secret_id uuid;
  v_secret_name text := 'ikms_api_key_boutique_' || p_boutique_id::text;
  v_cle_configuree boolean;
  v_mode_paiement text := upper(trim(coalesce(p_mode_paiement, 'A_LA_LIVRAISON')));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.peut_gerer_boutique(p_boutique_id)
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur marchand requis.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.boutiques where id = p_boutique_id) then
    raise exception 'Etablissement introuvable.';
  end if;
  select * into v_config from public.configuration_marketplace where id = 1;
  if v_mode_paiement not in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR') then
    raise exception 'Mode de paiement IKMS invalide.';
  end if;
  if upper(trim(coalesce(p_zone_depart, ''))) !~ '^[A-Z0-9_-]{2,50}$' then
    raise exception 'Code de zone de ramassage invalide.';
  end if;
  if trim(coalesce(p_expediteur_nom, '')) = '' or trim(coalesce(p_expediteur_adresse, '')) = '' then
    raise exception 'Nom et adresse de ramassage requis.';
  end if;
  if trim(coalesce(p_expediteur_tel, '')) !~ '^[0-9]{10}$' then
    raise exception 'Le telephone expediteur doit contenir 10 chiffres.';
  end if;
  if p_actif and nullif(trim(coalesce(v_config.ikms_api_base_url, '')), '') is null then
    raise exception 'Le superadministrateur doit configurer l''URL de l''API IKMS.';
  end if;

  select id into v_secret_id from vault.secrets where name = v_secret_name;
  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^ik_live_[A-Za-z0-9_-]{16,}$' then raise exception 'Cle API IKMS invalide.'; end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_api_key), v_secret_name,
        'Cle API IKMS de l''etablissement ' || p_boutique_id::text, null
      );
    else
      perform vault.update_secret(
        v_secret_id, trim(p_api_key), v_secret_name,
        'Cle API IKMS de l''etablissement ' || p_boutique_id::text, null
      );
    end if;
  end if;
  v_cle_configuree := v_secret_id is not null;
  if p_actif and not v_cle_configuree then raise exception 'La cle API IKMS est requise.'; end if;

  insert into public.integrations_ikms_boutique (
    boutique_id, zone_depart, expediteur_nom, expediteur_tel,
    expediteur_adresse, mode_paiement, cle_api_configuree, actif, derniere_erreur
  ) values (
    p_boutique_id, upper(trim(p_zone_depart)), trim(p_expediteur_nom), trim(p_expediteur_tel),
    trim(p_expediteur_adresse), v_mode_paiement, v_cle_configuree, p_actif, null
  ) on conflict (boutique_id) do update set
    zone_depart = excluded.zone_depart,
    expediteur_nom = excluded.expediteur_nom,
    expediteur_tel = excluded.expediteur_tel,
    expediteur_adresse = excluded.expediteur_adresse,
    mode_paiement = excluded.mode_paiement,
    cle_api_configuree = excluded.cle_api_configuree,
    actif = excluded.actif,
    derniere_erreur = null,
    modifie_le = now();
  return jsonb_build_object(
    'boutique_id', p_boutique_id, 'actif', p_actif,
    'cle_api_configuree', v_cle_configuree
  );
end;
$$;
