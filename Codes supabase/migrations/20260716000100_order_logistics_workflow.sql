-- IKIGAI Market - workflow de commande, integration IKMS et emails transactionnels.

set search_path = public, extensions;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.configuration_marketplace
  add column if not exists site_public_url text not null
    default 'https://ismaelfofana1998-cloud.github.io/MARKETPLACE/',
  add column if not exists ikms_tenant_nom text not null default 'IKIGAI Livraison',
  add column if not exists ikms_tenant_code text not null default 'IKIGAI',
  add column if not exists ikms_api_base_url text,
  add column if not exists ikms_portail_pro_url text,
  add column if not exists zones_livraison jsonb not null default '[]'::jsonb,
  add column if not exists nom_expediteur_email text not null default 'IKIGAI Market',
  add column if not exists email_expediteur text,
  add column if not exists email_api_configuree boolean not null default false,
  add column if not exists emails_transactionnels_actifs boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_zones_array_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_zones_array_check
      check (jsonb_typeof(zones_livraison) = 'array');
  end if;
end $$;

alter table public.adresses_livraison
  add column if not exists code_zone text;

alter table public.integrations_livraison
  add column if not exists zone_depart text,
  add column if not exists expediteur_nom text,
  add column if not exists expediteur_tel text,
  add column if not exists expediteur_adresse text,
  add column if not exists mode_paiement text not null default 'SANS_PAIEMENT',
  add column if not exists cle_api_configuree boolean not null default false,
  add column if not exists derniere_verification timestamptz,
  add column if not exists derniere_erreur text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.integrations_livraison'::regclass
      and conname = 'integrations_livraison_mode_paiement_check'
  ) then
    alter table public.integrations_livraison
      add constraint integrations_livraison_mode_paiement_check
      check (mode_paiement in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR'));
  end if;
end $$;

-- L'ancienne integration utilisait une cle globale partagee. Elle est desactivee
-- jusqu'a ce que le marchand enregistre sa propre cle de client pro IKMS.
update public.integrations_livraison
set actif = false, cle_api_configuree = false
where not cle_api_configuree;

alter table public.missions_logistiques
  add column if not exists statut_ikms text,
  add column if not exists code_ramassage text,
  add column if not exists id_colis text,
  add column if not exists code_livraison text,
  add column if not exists montant_livraison bigint,
  add column if not exists derniere_synchronisation timestamptz,
  add column if not exists reponse_ikms jsonb not null default '{}'::jsonb;

alter table public.missions_logistiques
  drop constraint if exists missions_logistiques_statut_check;
alter table public.missions_logistiques
  add constraint missions_logistiques_statut_check
  check (statut in (
    'A_ENVOYER', 'ENVOI_EN_COURS', 'ENVOYEE', 'ACCEPTEE', 'EN_COURS',
    'LIVREE', 'RETOUR', 'ANNULEE', 'ERREUR'
  ));

alter table public.historique_statuts_commande
  add column if not exists source text not null default 'SYSTEME';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.historique_statuts_commande'::regclass
      and conname = 'historique_statuts_source_check'
  ) then
    alter table public.historique_statuts_commande
      add constraint historique_statuts_source_check
      check (source in ('CLIENT', 'MARCHAND', 'IKMS', 'SYSTEME'));
  end if;
end $$;

create table if not exists public.notifications_email_commande (
  id uuid primary key default gen_random_uuid(),
  historique_id bigint not null unique
    references public.historique_statuts_commande(id) on delete cascade,
  commande_id uuid not null
    references public.commandes_marketplace(id) on delete cascade,
  destinataire_email text not null,
  destinataire_nom text,
  boutique_nom text not null,
  commande_reference text not null,
  statut_commande text not null,
  sujet text not null,
  message text not null,
  statut text not null default 'A_ENVOYER'
    check (statut in ('A_ENVOYER', 'EN_COURS', 'ENVOYEE', 'ERREUR')),
  tentatives integer not null default 0,
  prochaine_tentative timestamptz not null default now(),
  reference_fournisseur text,
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  envoyee_le timestamptz
);

create index if not exists notifications_email_a_envoyer_idx
  on public.notifications_email_commande(prochaine_tentative, cree_le)
  where statut in ('A_ENVOYER', 'ERREUR');
create index if not exists notifications_email_commande_idx
  on public.notifications_email_commande(commande_id, cree_le desc);
create index if not exists missions_externe_idx
  on public.missions_logistiques(commande_livraison_externe_id)
  where commande_livraison_externe_id is not null;
create index if not exists missions_sync_idx
  on public.missions_logistiques(derniere_synchronisation, modifie_le)
  where statut in ('ENVOYEE', 'ACCEPTEE', 'EN_COURS', 'RETOUR');

drop trigger if exists notifications_email_toucher_modification
on public.notifications_email_commande;
create trigger notifications_email_toucher_modification
before update on public.notifications_email_commande
for each row execute function private.toucher_modification();

create or replace function private.journaliser_statut_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change_par uuid;
  v_change_par_brut text := nullif(current_setting('ikigai.change_par', true), '');
  v_source text := nullif(current_setting('ikigai.source_statut', true), '');
  v_acheteur uuid;
begin
  v_change_par := coalesce(v_change_par_brut::uuid, (select auth.uid()));

  if v_source is null then
    select a.acheteur_id into v_acheteur
    from public.achats a
    where a.id = new.achat_id;

    v_source := case
      when v_change_par is null then 'SYSTEME'
      when v_change_par = v_acheteur then 'CLIENT'
      else 'MARCHAND'
    end;
  end if;

  if tg_op = 'INSERT' or old.statut is distinct from new.statut then
    insert into public.historique_statuts_commande
      (commande_id, ancien_statut, nouveau_statut, change_par, note, source)
    values
      (new.id, case when tg_op = 'INSERT' then null else old.statut end,
       new.statut, v_change_par, new.motif_annulation, v_source);
  end if;
  return new;
end;
$$;

drop trigger if exists commandes_marketplace_historique
on public.commandes_marketplace;
create trigger commandes_marketplace_historique
after insert or update of statut on public.commandes_marketplace
for each row execute function private.journaliser_statut_commande();

create or replace function private.mettre_notification_commande_en_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications_email_commande (
    historique_id, commande_id, destinataire_email, destinataire_nom,
    boutique_nom, commande_reference, statut_commande, sujet, message
  )
  select
    new.id,
    c.id,
    i.email::text,
    coalesce(nullif(trim(a_liv.destinataire_nom), ''), nullif(trim(concat_ws(' ', i.prenom, i.nom)), ''), 'Client'),
    b.nom,
    c.reference,
    new.nouveau_statut,
    case new.nouveau_statut
      when 'NOUVELLE' then 'Commande ' || c.reference || ' recue'
      when 'CONFIRMEE' then 'Commande ' || c.reference || ' confirmee'
      when 'EN_PREPARATION' then 'Preparation de la commande ' || c.reference
      when 'PRETE' then 'Commande ' || c.reference || ' prete pour la livraison'
      when 'EN_LIVRAISON' then 'Commande ' || c.reference || ' transmise au livreur'
      when 'LIVREE' then 'Commande ' || c.reference || ' livree'
      when 'ANNULEE' then 'Commande ' || c.reference || ' annulee'
      else 'Mise a jour de la commande ' || c.reference
    end,
    case new.nouveau_statut
      when 'NOUVELLE' then 'Votre commande a bien ete recue par la boutique.'
      when 'CONFIRMEE' then 'La boutique a confirme votre commande.'
      when 'EN_PREPARATION' then 'La preparation de votre commande a commence.'
      when 'PRETE' then 'Votre commande est prete et attend sa transmission a IKIGAI Livraison.'
      when 'EN_LIVRAISON' then 'Votre commande a ete transmise a IKIGAI Livraison.'
      when 'LIVREE' then 'IKIGAI Livraison a confirme la livraison de votre commande.'
      when 'ANNULEE' then 'Votre commande a ete annulee.'
      else 'Le statut de votre commande a ete mis a jour.'
    end
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  join public.identites i on i.id = a.acheteur_id
  join public.boutiques b on b.id = c.boutique_id
  left join public.adresses_livraison a_liv on a_liv.id = a.adresse_livraison_id
  where c.id = new.commande_id
    and nullif(trim(i.email::text), '') is not null
  on conflict (historique_id) do nothing;
  return new;
end;
$$;

drop trigger if exists historique_statut_notification_email
on public.historique_statuts_commande;
create trigger historique_statut_notification_email
after insert on public.historique_statuts_commande
for each row execute function private.mettre_notification_commande_en_file();

create or replace function public.rpc_configurer_integration_ikms(
  p_organisation_id uuid,
  p_zone_depart text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_mode_paiement text default 'SANS_PAIEMENT',
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
  v_secret_name text := 'ikms_api_key_' || p_organisation_id::text;
  v_cle_configuree boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN'])
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur marchand requis.' using errcode = '42501';
  end if;

  select * into v_config from public.configuration_marketplace where id = 1;
  if p_mode_paiement not in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR') then
    raise exception 'Mode de paiement IKMS invalide.';
  end if;
  if upper(trim(coalesce(p_zone_depart, ''))) !~ '^[A-Z0-9_-]{2,50}$' then
    raise exception 'Code de zone de ramassage invalide.';
  end if;
  if trim(coalesce(p_expediteur_nom, '')) = ''
     or trim(coalesce(p_expediteur_adresse, '')) = '' then
    raise exception 'Nom et adresse de ramassage requis.';
  end if;
  if trim(coalesce(p_expediteur_tel, '')) !~ '^[0-9]{10}$' then
    raise exception 'Le telephone expediteur doit contenir 10 chiffres.';
  end if;
  if p_actif and nullif(trim(coalesce(v_config.ikms_api_base_url, '')), '') is null then
    raise exception 'Le superadministrateur doit configurer l''URL de l''API IKMS.';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name = v_secret_name;

  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^ik_live_[A-Za-z0-9_-]{16,}$' then
      raise exception 'Cle API IKMS invalide.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_api_key), v_secret_name,
        'Cle API IKMS du client pro marchand ' || p_organisation_id::text, null
      );
    else
      perform vault.update_secret(
        v_secret_id, trim(p_api_key), v_secret_name,
        'Cle API IKMS du client pro marchand ' || p_organisation_id::text, null
      );
    end if;
  end if;

  v_cle_configuree := v_secret_id is not null;
  if p_actif and not v_cle_configuree then
    raise exception 'La cle API du compte client pro IKMS est requise.';
  end if;

  insert into public.integrations_livraison (
    organisation_id, code_entreprise_livraison, compte_pro_externe_id,
    zone_depart, expediteur_nom, expediteur_tel, expediteur_adresse,
    mode_paiement, cle_api_configuree, actif, derniere_erreur
  ) values (
    p_organisation_id, v_config.ikms_tenant_code, null,
    upper(trim(p_zone_depart)), trim(p_expediteur_nom), trim(p_expediteur_tel),
    trim(p_expediteur_adresse), p_mode_paiement, v_cle_configuree, p_actif, null
  )
  on conflict (organisation_id) do update set
    code_entreprise_livraison = excluded.code_entreprise_livraison,
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
    'organisation_id', p_organisation_id,
    'actif', p_actif,
    'cle_api_configuree', v_cle_configuree
  );
end;
$$;

create or replace function public.rpc_configurer_email_transactionnel(
  p_email_expediteur text,
  p_nom_expediteur text,
  p_site_public_url text,
  p_api_key text default null,
  p_actif boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret_name text := 'ikigai_market_resend_api_key';
  v_cle_configuree boolean;
begin
  if (select auth.uid()) is null
     or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if trim(coalesce(p_email_expediteur, '')) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Adresse email expediteur invalide.';
  end if;
  if trim(coalesce(p_nom_expediteur, '')) = '' then
    raise exception 'Nom expediteur requis.';
  end if;
  if trim(coalesce(p_site_public_url, '')) !~ '^https://[^[:space:]]+$' then
    raise exception 'URL publique HTTPS requise.';
  end if;

  select id into v_secret_id from vault.secrets where name = v_secret_name;
  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^re_[A-Za-z0-9_-]{16,}$' then
      raise exception 'Cle API Resend invalide.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_api_key), v_secret_name,
        'Cle Resend pour les emails de statut IKIGAI Market', null
      );
    else
      perform vault.update_secret(
        v_secret_id, trim(p_api_key), v_secret_name,
        'Cle Resend pour les emails de statut IKIGAI Market', null
      );
    end if;
  end if;

  v_cle_configuree := v_secret_id is not null;
  if p_actif and not v_cle_configuree then
    raise exception 'La cle API Resend est requise pour activer les emails.';
  end if;

  update public.configuration_marketplace
  set email_expediteur = lower(trim(p_email_expediteur)),
      nom_expediteur_email = trim(p_nom_expediteur),
      site_public_url = trim(trailing '/' from trim(p_site_public_url)) || '/',
      email_api_configuree = v_cle_configuree,
      emails_transactionnels_actifs = p_actif
  where id = 1;

  return jsonb_build_object(
    'actif', p_actif,
    'cle_api_configuree', v_cle_configuree
  );
end;
$$;

create or replace function public.rpc_lire_integration_ikms(
  p_organisation_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organisation_id', i.organisation_id,
    'actif', i.actif,
    'api_base_url', c.ikms_api_base_url,
    'tenant_nom', c.ikms_tenant_nom,
    'tenant_code', c.ikms_tenant_code,
    'api_key', s.decrypted_secret,
    'zone_depart', i.zone_depart,
    'expediteur_nom', i.expediteur_nom,
    'expediteur_tel', i.expediteur_tel,
    'expediteur_adresse', i.expediteur_adresse,
    'mode_paiement', i.mode_paiement
  )
  from public.integrations_livraison i
  cross join public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = 'ikms_api_key_' || i.organisation_id::text
  where i.organisation_id = p_organisation_id and c.id = 1;
$$;

create or replace function public.rpc_lire_configuration_email()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'actif', c.emails_transactionnels_actifs,
    'api_key', s.decrypted_secret,
    'email_expediteur', c.email_expediteur,
    'nom_expediteur', c.nom_expediteur_email,
    'site_public_url', c.site_public_url,
    'nom_marketplace', c.nom,
    'couleur_primaire', c.couleur_primaire
  )
  from public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = 'ikigai_market_resend_api_key'
  where c.id = 1;
$$;

create or replace function public.rpc_verifier_secret_operations(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'ikigai_market_operations_secret'
      and extensions.digest(s.decrypted_secret, 'sha256')
          = extensions.digest(coalesce(p_secret, ''), 'sha256')
  );
$$;

create or replace function public.rpc_reclamer_mission_ikms(
  p_commande_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande record;
  v_mission public.missions_logistiques%rowtype;
begin
  select c.id, c.statut, i.code_entreprise_livraison, i.compte_pro_externe_id
  into v_commande
  from public.commandes_marketplace c
  join public.boutiques b on b.id = c.boutique_id
  join public.integrations_livraison i on i.organisation_id = b.organisation_id
  where c.id = p_commande_id and i.actif and i.cle_api_configuree
  for update of c;

  if v_commande.id is null then
    raise exception 'Commande ou integration IKMS indisponible.';
  end if;

  insert into public.missions_logistiques (
    commande_id, entreprise_livraison_code, compte_pro_externe_id, payload
  ) values (
    p_commande_id, v_commande.code_entreprise_livraison,
    v_commande.compte_pro_externe_id, coalesce(p_payload, '{}'::jsonb)
  ) on conflict (commande_id) do nothing;

  select * into v_mission
  from public.missions_logistiques
  where commande_id = p_commande_id
  for update;

  if v_mission.commande_livraison_externe_id is not null then
    return jsonb_build_object(
      'envoyer', false,
      'mission_id', v_mission.id,
      'commande_livraison_id', v_mission.commande_livraison_externe_id
    );
  end if;
  if v_commande.statut <> 'PRETE' then
    raise exception 'La commande doit etre prete avant transmission.';
  end if;
  if v_mission.statut = 'ENVOI_EN_COURS'
     and v_mission.modifie_le > now() - interval '2 minutes' then
    raise exception 'La transmission IKMS est deja en cours.';
  end if;

  update public.missions_logistiques
  set statut = 'ENVOI_EN_COURS', payload = coalesce(p_payload, '{}'::jsonb),
      tentatives = tentatives + 1, derniere_erreur = null
  where id = v_mission.id;

  return jsonb_build_object('envoyer', true, 'mission_id', v_mission.id);
end;
$$;

create or replace function public.rpc_finaliser_mission_ikms(
  p_mission_id uuid,
  p_acteur_id uuid,
  p_succes boolean,
  p_commande_externe_id text default null,
  p_code_ramassage text default null,
  p_id_colis text default null,
  p_code_livraison text default null,
  p_montant_livraison bigint default null,
  p_reponse jsonb default '{}'::jsonb,
  p_erreur text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande_id uuid;
begin
  select commande_id into v_commande_id
  from public.missions_logistiques
  where id = p_mission_id
  for update;
  if v_commande_id is null then raise exception 'Mission IKMS introuvable.'; end if;

  if not p_succes then
    update public.missions_logistiques
    set statut = 'ERREUR', derniere_erreur = left(coalesce(p_erreur, 'Erreur IKMS'), 2000),
        reponse_ikms = coalesce(p_reponse, '{}'::jsonb), derniere_synchronisation = now()
    where id = p_mission_id;
    return jsonb_build_object('succes', false, 'commande_id', v_commande_id);
  end if;

  if nullif(trim(coalesce(p_commande_externe_id, '')), '') is null then
    raise exception 'Identifiant de commande IKMS manquant.';
  end if;

  update public.missions_logistiques
  set statut = 'ENVOYEE', statut_ikms = 'CREE',
      commande_livraison_externe_id = trim(p_commande_externe_id),
      code_ramassage = p_code_ramassage, id_colis = p_id_colis,
      code_livraison = p_code_livraison, montant_livraison = p_montant_livraison,
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_erreur = null, derniere_synchronisation = now()
  where id = p_mission_id;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
  perform set_config('ikigai.change_par', coalesce(p_acteur_id::text, ''), true);
  update public.commandes_marketplace
  set statut = 'EN_LIVRAISON'
  where id = v_commande_id and statut = 'PRETE';

  return jsonb_build_object(
    'succes', true,
    'commande_id', v_commande_id,
    'commande_livraison_id', trim(p_commande_externe_id)
  );
end;
$$;

create or replace function public.rpc_appliquer_statut_ikms(
  p_mission_id uuid,
  p_statut_ikms text,
  p_reponse jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande_id uuid;
  v_statut_interne text;
  v_livree boolean := false;
begin
  select commande_id into v_commande_id
  from public.missions_logistiques
  where id = p_mission_id
  for update;
  if v_commande_id is null then raise exception 'Mission IKMS introuvable.'; end if;

  v_statut_interne := case
    when p_statut_ikms = 'LIVRE' then 'LIVREE'
    when p_statut_ikms in (
      'RETOUR_EN_COURS', 'RETOUR_DEMANDE', 'RETOUR_RECU',
      'A_RETOURNER', 'RETOUR_ASSIGNE', 'RETOURNE'
    ) then 'RETOUR'
    when p_statut_ikms = 'ANNULE' then 'ANNULEE'
    else 'EN_COURS'
  end;

  update public.missions_logistiques
  set statut = v_statut_interne,
      statut_ikms = upper(trim(coalesce(p_statut_ikms, 'INCONNU'))),
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_synchronisation = now(),
      derniere_erreur = case
        when p_statut_ikms = 'ANNULE' then 'La mission a ete annulee dans IKMS.'
        else null
      end
  where id = p_mission_id;

  if p_statut_ikms = 'LIVRE' then
    perform set_config('ikigai.source_statut', 'IKMS', true);
    perform set_config('ikigai.change_par', '', true);
    update public.commandes_marketplace
    set statut = 'LIVREE'
    where id = v_commande_id and statut = 'EN_LIVRAISON';
    v_livree := found;
  end if;

  return jsonb_build_object(
    'commande_id', v_commande_id,
    'statut_mission', v_statut_interne,
    'commande_livree', v_livree
  );
end;
$$;

create or replace function public.rpc_reclamer_notifications_email(
  p_commande_id uuid default null,
  p_limite integer default 30
) returns setof public.notifications_email_commande
language sql
security definer
set search_path = ''
as $$
  with candidats as (
    select n.id
    from public.notifications_email_commande n
    where (p_commande_id is null or n.commande_id = p_commande_id)
      and (
        n.statut = 'A_ENVOYER'
        or (n.statut = 'ERREUR' and n.prochaine_tentative <= now())
        or (n.statut = 'EN_COURS' and n.modifie_le < now() - interval '10 minutes')
      )
    order by n.cree_le
    for update skip locked
    limit least(greatest(coalesce(p_limite, 30), 1), 100)
  )
  update public.notifications_email_commande n
  set statut = 'EN_COURS', tentatives = n.tentatives + 1,
      derniere_erreur = null, modifie_le = now()
  from candidats c
  where n.id = c.id
  returning n.*;
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
    when 'PRETE' then p_nouveau_statut = 'ANNULEE'
    else false
  end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
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
  perform set_config('ikigai.source_statut', 'CLIENT', true);
  update public.commandes_marketplace
  set statut = 'ANNULEE', annulee_par = (select auth.uid()),
      motif_annulation = nullif(trim(p_motif), '')
  where id = p_commande_id;
end;
$$;

alter table public.notifications_email_commande enable row level security;

drop policy if exists integrations_gestionnaires on public.integrations_livraison;
drop policy if exists integrations_lecture_administrateurs on public.integrations_livraison;
create policy integrations_lecture_administrateurs
on public.integrations_livraison for select to authenticated
using (
  (select private.est_membre_organisation(
    integrations_livraison.organisation_id,
    array['PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE', 'AGENT']
  ))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
);

revoke all on public.notifications_email_commande from public, anon, authenticated;
revoke insert, update, delete on public.integrations_livraison from authenticated;
grant select on public.integrations_livraison to authenticated;

revoke all on function private.journaliser_statut_commande() from public, anon, authenticated;
revoke all on function private.mettre_notification_commande_en_file() from public, anon, authenticated;

revoke all on function public.rpc_configurer_integration_ikms(uuid, text, text, text, text, text, text, boolean)
from public, anon;
revoke all on function public.rpc_configurer_email_transactionnel(text, text, text, text, boolean)
from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text, text)
from public, anon;
revoke all on function public.rpc_annuler_commande_client(uuid, text)
from public, anon;

grant execute on function public.rpc_configurer_integration_ikms(uuid, text, text, text, text, text, text, boolean)
to authenticated;
grant execute on function public.rpc_configurer_email_transactionnel(text, text, text, text, boolean)
to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text, text)
to authenticated;
grant execute on function public.rpc_annuler_commande_client(uuid, text)
to authenticated;

revoke all on function public.rpc_lire_integration_ikms(uuid) from public, anon, authenticated;
revoke all on function public.rpc_lire_configuration_email() from public, anon, authenticated;
revoke all on function public.rpc_verifier_secret_operations(text) from public, anon, authenticated;
revoke all on function public.rpc_reclamer_mission_ikms(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_finaliser_mission_ikms(uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text)
from public, anon, authenticated;
revoke all on function public.rpc_appliquer_statut_ikms(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_reclamer_notifications_email(uuid, integer) from public, anon, authenticated;

grant execute on function public.rpc_lire_integration_ikms(uuid) to service_role;
grant execute on function public.rpc_lire_configuration_email() to service_role;
grant execute on function public.rpc_verifier_secret_operations(text) to service_role;
grant execute on function public.rpc_reclamer_mission_ikms(uuid, jsonb) to service_role;
grant execute on function public.rpc_finaliser_mission_ikms(uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text)
to service_role;
grant execute on function public.rpc_appliquer_statut_ikms(uuid, text, jsonb) to service_role;
grant execute on function public.rpc_reclamer_notifications_email(uuid, integer) to service_role;

do $$
declare
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.secrets
  where name = 'ikigai_market_project_url';
  if v_secret_id is null then
    perform vault.create_secret(
      'https://fnizsjcvjbibdwmtvftq.supabase.co',
      'ikigai_market_project_url',
      'URL du projet IKIGAI Market pour les taches planifiees', null
    );
  else
    perform vault.update_secret(
      v_secret_id, 'https://fnizsjcvjbibdwmtvftq.supabase.co',
      'ikigai_market_project_url',
      'URL du projet IKIGAI Market pour les taches planifiees', null
    );
  end if;

  select id into v_secret_id from vault.secrets
  where name = 'ikigai_market_operations_secret';
  if v_secret_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'ikigai_market_operations_secret',
      'Secret interne des taches IKMS et notifications', null
    );
  end if;
end $$;

do $outer$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'ikigai-market-operations'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'ikigai-market-operations',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'ikigai_market_project_url'
        ) || '/functions/v1/sync-livraisons',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-ikigai-cron-secret', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'ikigai_market_operations_secret'
          )
        ),
        body := '{"batch":true}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end;
$outer$;
