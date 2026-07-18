-- IKIGAI Market - zones IKMS automatiques, validation tarifee et secrets Wave
-- isoles par organisation marchande.

set search_path = public, extensions;

alter table public.identites
  add column if not exists zone_livraison text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.identites'::regclass
      and conname = 'identites_zone_livraison_check'
  ) then
    alter table public.identites
      add constraint identites_zone_livraison_check
      check (
        zone_livraison is null
        or zone_livraison ~ '^[A-Z0-9_-]{2,50}$'
      );
  end if;
end $$;

create or replace function private.creer_identite_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text := upper(trim(coalesce(new.raw_user_meta_data ->> 'zone_livraison', '')));
begin
  insert into public.identites (id, email, prenom, nom, telephone, zone_livraison)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'prenom'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'nom'), ''),
    nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'telephone')), ''),
    case when v_zone ~ '^[A-Z0-9_-]{2,50}$' then v_zone else null end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

alter table public.configuration_marketplace
  add column if not exists ikms_catalogue_cle_configuree boolean not null default false,
  add column if not exists livraison_a_partir_de bigint not null default 1000;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_livraison_minimum_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_livraison_minimum_check
      check (livraison_a_partir_de between 0 and 5000000);
  end if;
end $$;

create or replace function public.rpc_configurer_ikms_plateforme(
  p_ikms_tenant_nom text,
  p_ikms_tenant_code text,
  p_ikms_api_base_url text,
  p_ikms_portail_pro_url text default null,
  p_ikms_catalogue_api_key text default null,
  p_livraison_a_partir_de bigint default 1000
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret_name text := 'ikms_api_key_catalogue_plateforme';
  v_cle_configuree boolean;
begin
  if (select auth.uid()) is null
     or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_ikms_tenant_nom, ''))) not between 2 and 120 then
    raise exception 'Nom du tenant IKMS invalide.';
  end if;
  if upper(trim(coalesce(p_ikms_tenant_code, ''))) !~ '^[A-Z0-9_-]{2,50}$' then
    raise exception 'Code du tenant IKMS invalide.';
  end if;
  if trim(coalesce(p_ikms_api_base_url, '')) !~ '^https://[^[:space:]]+/functions/v1/[^[:space:]]+$' then
    raise exception 'URL api-v1 IKMS HTTPS requise.';
  end if;
  if p_ikms_portail_pro_url is not null
     and trim(p_ikms_portail_pro_url) <> ''
     and trim(p_ikms_portail_pro_url) !~ '^https://[^[:space:]]+$' then
    raise exception 'URL du portail IKMS invalide.';
  end if;
  if p_livraison_a_partir_de not between 0 and 5000000 then
    raise exception 'Montant minimum de livraison invalide.';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name = v_secret_name;

  if nullif(trim(coalesce(p_ikms_catalogue_api_key, '')), '') is not null then
    if trim(p_ikms_catalogue_api_key) !~ '^ik_live_[A-Za-z0-9_-]{16,}$' then
      raise exception 'Cle API IKMS invalide.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_ikms_catalogue_api_key),
        v_secret_name,
        'Cle IKMS serveur pour le catalogue des zones Marketplace',
        null
      );
    else
      perform vault.update_secret(
        v_secret_id,
        trim(p_ikms_catalogue_api_key),
        v_secret_name,
        'Cle IKMS serveur pour le catalogue des zones Marketplace',
        null
      );
    end if;
  end if;

  v_cle_configuree := v_secret_id is not null;
  update public.configuration_marketplace
  set ikms_tenant_nom = trim(p_ikms_tenant_nom),
      ikms_tenant_code = upper(trim(p_ikms_tenant_code)),
      ikms_api_base_url = trim(trailing '/' from trim(p_ikms_api_base_url)),
      ikms_portail_pro_url = nullif(trim(coalesce(p_ikms_portail_pro_url, '')), ''),
      ikms_catalogue_cle_configuree = v_cle_configuree,
      livraison_a_partir_de = p_livraison_a_partir_de,
      modifie_le = now()
  where id = 1;

  return jsonb_build_object(
    'ikms_catalogue_cle_configuree', v_cle_configuree,
    'livraison_a_partir_de', p_livraison_a_partir_de
  );
end;
$$;

create or replace function public.rpc_lire_configuration_ikms_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'api_base_url', c.ikms_api_base_url,
    'api_key', s.decrypted_secret,
    'livraison_a_partir_de', c.livraison_a_partir_de
  )
  from public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = 'ikms_api_key_catalogue_plateforme'
  where c.id = 1;
$$;

revoke all on function public.rpc_configurer_ikms_plateforme(text, text, text, text, text, bigint)
  from public, anon;
grant execute on function public.rpc_configurer_ikms_plateforme(text, text, text, text, text, bigint)
  to authenticated;
revoke all on function public.rpc_lire_configuration_ikms_catalogue()
  from public, anon, authenticated;
grant execute on function public.rpc_lire_configuration_ikms_catalogue()
  to service_role;

-- Les marchands conservent leurs etapes internes de preparation, mais le
-- client ne recoit un email que pour les quatre jalons metier convenus.
create or replace function private.mettre_notification_commande_en_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.nouveau_statut not in ('CONFIRMEE', 'EN_LIVRAISON', 'LIVREE', 'ANNULEE') then
    return new;
  end if;

  insert into public.notifications_email_commande (
    historique_id, commande_id, destinataire_email, destinataire_nom,
    boutique_nom, commande_reference, statut_commande, sujet, message
  )
  select
    new.id,
    c.id,
    i.email::text,
    coalesce(
      nullif(trim(a_liv.destinataire_nom), ''),
      nullif(trim(concat_ws(' ', i.prenom, i.nom)), ''),
      'Client'
    ),
    b.nom,
    c.reference,
    new.nouveau_statut,
    case new.nouveau_statut
      when 'CONFIRMEE' then 'Commande ' || c.reference || ' confirmee'
      when 'EN_LIVRAISON' then 'Commande ' || c.reference || ' confiee au livreur'
      when 'LIVREE' then 'Commande ' || c.reference || ' livree'
      when 'ANNULEE' then 'Commande ' || c.reference || ' annulee'
    end,
    case new.nouveau_statut
      when 'CONFIRMEE' then 'La boutique a confirme votre commande.'
      when 'EN_LIVRAISON' then 'Votre commande a ete confiee au livreur.'
      when 'LIVREE' then 'La livraison de votre commande est confirmee.'
      when 'ANNULEE' then 'Votre commande a ete annulee.'
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

revoke all on function private.mettre_notification_commande_en_file()
  from public, anon, authenticated, service_role;

-- Evite qu'une ancienne micro-transition deja en file soit envoyee apres
-- l'activation de cette regle. Les emails deja envoyes restent dans l'historique.
delete from public.notifications_email_commande
where statut <> 'ENVOYEE'
  and statut_commande not in ('CONFIRMEE', 'EN_LIVRAISON', 'LIVREE', 'ANNULEE');

-- Configuration Wave par tenant marchand. Le paiement reste masque au checkout
-- tant que le parcours multi-tenant n'est pas active explicitement.
create table if not exists public.configurations_wave_organisation (
  organisation_id uuid primary key
    references public.organisations(id) on delete cascade,
  actif boolean not null default false,
  api_key_configuree boolean not null default false,
  signing_secret_configure boolean not null default false,
  api_key_suffixe text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

drop trigger if exists configurations_wave_organisation_toucher_modification
on public.configurations_wave_organisation;
create trigger configurations_wave_organisation_toucher_modification
before update on public.configurations_wave_organisation
for each row execute function private.toucher_modification();

alter table public.configurations_wave_organisation enable row level security;
revoke all on table public.configurations_wave_organisation from public, anon;

drop policy if exists configurations_wave_organisation_lecture
on public.configurations_wave_organisation;
create policy configurations_wave_organisation_lecture
on public.configurations_wave_organisation for select
to authenticated
using (
  (select private.est_membre_organisation(
    organisation_id,
    array['PROPRIETAIRE', 'ADMIN']
  ))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
);

grant select on public.configurations_wave_organisation to authenticated;
revoke insert, update, delete on public.configurations_wave_organisation
  from anon, authenticated;

create or replace function public.rpc_configurer_wave_organisation(
  p_organisation_id uuid,
  p_api_key text default null,
  p_signing_secret text default null,
  p_actif boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_api_secret_id uuid;
  v_signing_secret_id uuid;
  v_api_name text := 'wave_api_key_organisation_' || p_organisation_id::text;
  v_signing_name text := 'wave_signing_secret_organisation_' || p_organisation_id::text;
  v_api_configuree boolean;
  v_signing_configure boolean;
  v_suffixe text;
begin
  if (select auth.uid()) is null
     or (
       not private.est_membre_organisation(
         p_organisation_id,
         array['PROPRIETAIRE', 'ADMIN']
       )
       and not private.est_admin_plateforme(array['SUPER_ADMIN'])
     ) then
    raise exception 'Droit administrateur du tenant requis.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organisations
    where id = p_organisation_id and type in ('MARCHAND', 'RESTAURANT')
  ) then
    raise exception 'Tenant marchand introuvable.';
  end if;

  select id into v_api_secret_id from vault.secrets where name = v_api_name;
  select id into v_signing_secret_id from vault.secrets where name = v_signing_name;

  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^wave_[A-Za-z0-9_-]{20,}$' then
      raise exception 'Cle API Wave invalide.';
    end if;
    if v_api_secret_id is null then
      v_api_secret_id := vault.create_secret(
        trim(p_api_key), v_api_name,
        'Cle API Wave du tenant ' || p_organisation_id::text, null
      );
    else
      perform vault.update_secret(
        v_api_secret_id, trim(p_api_key), v_api_name,
        'Cle API Wave du tenant ' || p_organisation_id::text, null
      );
    end if;
    v_suffixe := right(trim(p_api_key), 4);
  else
    select api_key_suffixe into v_suffixe
    from public.configurations_wave_organisation
    where organisation_id = p_organisation_id;
  end if;

  if nullif(trim(coalesce(p_signing_secret, '')), '') is not null then
    if trim(p_signing_secret) !~ '^wave_[A-Za-z0-9_-]{20,}$' then
      raise exception 'Secret de signature Wave invalide.';
    end if;
    if v_signing_secret_id is null then
      v_signing_secret_id := vault.create_secret(
        trim(p_signing_secret), v_signing_name,
        'Secret de signature Wave du tenant ' || p_organisation_id::text, null
      );
    else
      perform vault.update_secret(
        v_signing_secret_id, trim(p_signing_secret), v_signing_name,
        'Secret de signature Wave du tenant ' || p_organisation_id::text, null
      );
    end if;
  end if;

  v_api_configuree := v_api_secret_id is not null;
  v_signing_configure := v_signing_secret_id is not null;
  if p_actif and (not v_api_configuree or not v_signing_configure) then
    raise exception 'Cle API et secret de signature Wave requis.';
  end if;

  insert into public.configurations_wave_organisation (
    organisation_id, actif, api_key_configuree,
    signing_secret_configure, api_key_suffixe
  ) values (
    p_organisation_id, p_actif, v_api_configuree,
    v_signing_configure, v_suffixe
  )
  on conflict (organisation_id) do update set
    actif = excluded.actif,
    api_key_configuree = excluded.api_key_configuree,
    signing_secret_configure = excluded.signing_secret_configure,
    api_key_suffixe = excluded.api_key_suffixe,
    modifie_le = now();

  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'actif', p_actif,
    'api_key_configuree', v_api_configuree,
    'signing_secret_configure', v_signing_configure,
    'api_key_suffixe', v_suffixe
  );
end;
$$;

revoke all on function public.rpc_configurer_wave_organisation(uuid, text, text, boolean)
  from public, anon;
grant execute on function public.rpc_configurer_wave_organisation(uuid, text, text, boolean)
  to authenticated;

alter table public.commandes_marketplace
  add column if not exists frais_livraison_a_confirmer boolean not null default true;

alter table public.achats
  add column if not exists frais_livraison_a_confirmer boolean not null default true;

-- Ne marque pas les anciennes commandes deja terminees ou deja tarifees par
-- IKMS comme si elles attendaient encore un prix.
update public.commandes_marketplace c
set frais_livraison_a_confirmer = false
where c.statut in ('LIVREE', 'ANNULEE')
   or exists (
     select 1
     from public.missions_logistiques m
     where m.commande_id = c.id
       and m.montant_livraison is not null
   );

update public.achats a
set frais_livraison_a_confirmer = exists (
  select 1
  from public.commandes_marketplace c
  where c.achat_id = a.id
    and c.statut <> 'ANNULEE'
    and c.frais_livraison_a_confirmer
);

comment on column public.commandes_marketplace.frais_livraison_a_confirmer is
  'Vrai tant que POST /commandes IKMS n''a pas renvoye colis[].montant_livraison.';
comment on column public.achats.frais_livraison_a_confirmer is
  'Vrai tant qu''au moins une commande du panier attend le tarif definitif IKMS.';

-- Les montants passes ici ont ete recalcules cote serveur, mais restent des
-- estimations d'affichage : ils sont controles puis volontairement non
-- persistes. Seul POST /commandes fixe ensuite les frais et le total payables.
create or replace function public.rpc_valider_panier_tarife(
  p_acheteur_id uuid,
  p_adresse_id uuid,
  p_mode_paiement text,
  p_note text default null,
  p_boutique_contexte_id uuid default null,
  p_frais_par_boutique jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_panier uuid;
  v_achat uuid;
  v_commande uuid;
  v_boutique record;
  v_ligne record;
  v_sous_total bigint;
  v_total_achat bigint := 0;
  v_frais_texte text;
  v_reference text;
begin
  if p_acheteur_id is null then
    raise exception 'Acheteur requis.';
  end if;
  if p_mode_paiement <> 'A_LA_LIVRAISON' then
    raise exception 'Mode de paiement momentanement indisponible.';
  end if;
  if jsonb_typeof(coalesce(p_frais_par_boutique, '{}'::jsonb)) <> 'object' then
    raise exception 'Estimations de livraison invalides.';
  end if;
  if not exists (
    select 1
    from public.adresses_livraison
    where id = p_adresse_id
      and identite_id = p_acheteur_id
      and nullif(trim(code_zone), '') is not null
  ) then
    raise exception 'Adresse ou zone de livraison invalide.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_acheteur_id::text || ':' ||
    coalesce(p_boutique_contexte_id::text, 'MARKETPLACE'),
    0
  ));

  select id into v_panier
  from public.paniers
  where identite_id = p_acheteur_id
    and statut = 'ACTIF'
    and boutique_contexte_id is not distinct from p_boutique_contexte_id
  for update;

  if v_panier is null
     or not exists (
       select 1 from public.lignes_panier where panier_id = v_panier
     ) then
    raise exception 'Le panier est vide.';
  end if;
  if p_boutique_contexte_id is not null and exists (
    select 1
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    where lp.panier_id = v_panier
      and p.boutique_id <> p_boutique_contexte_id
  ) then
    raise exception 'Le panier contient un produit d''un autre Site dedie.'
      using errcode = '42501';
  end if;

  v_reference := 'ACH-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.achats (
    reference, acheteur_id, adresse_livraison_id, mode_paiement,
    boutique_contexte_id, frais_livraison_a_confirmer
  ) values (
    v_reference, p_acheteur_id, p_adresse_id, p_mode_paiement,
    p_boutique_contexte_id, true
  )
  returning id into v_achat;

  for v_boutique in
    select distinct b.id
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    join public.boutiques b on b.id = p.boutique_id
    where lp.panier_id = v_panier
      and p.statut = 'ACTIF'
      and b.statut = 'PUBLIEE'
      and (
        p_boutique_contexte_id is null
        or b.id = p_boutique_contexte_id
      )
  loop
    v_frais_texte := p_frais_par_boutique ->> v_boutique.id::text;
    if v_frais_texte is not null then
      if v_frais_texte !~ '^[0-9]+$'
         or v_frais_texte::numeric > 5000000 then
        raise exception 'Estimation de livraison invalide pour une boutique.';
      end if;
    end if;

    v_sous_total := 0;
    insert into public.commandes_marketplace (
      achat_id, boutique_id, reference, frais_livraison,
      frais_livraison_a_confirmer, note_client
    ) values (
      v_achat,
      v_boutique.id,
      'CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      0,
      true,
      nullif(trim(coalesce(p_note, '')), '')
    )
    returning id into v_commande;

    for v_ligne in
      select
        lp.quantite,
        v.id as variante_id,
        v.nom as variante_nom,
        p.id as produit_id,
        p.nom as produit_nom,
        p.images,
        coalesce(v.prix, p.prix) as prix,
        s.quantite as stock
      from public.lignes_panier lp
      join public.variantes_produit v
        on v.id = lp.variante_id and v.actif
      join public.produits p
        on p.id = v.produit_id and p.statut = 'ACTIF'
      join public.stocks s on s.variante_id = v.id
      where lp.panier_id = v_panier
        and p.boutique_id = v_boutique.id
      for update of s
    loop
      if v_ligne.stock < v_ligne.quantite then
        raise exception 'Stock insuffisant pour %.', v_ligne.produit_nom;
      end if;

      update public.stocks
      set quantite = quantite - v_ligne.quantite,
          modifie_le = now()
      where variante_id = v_ligne.variante_id;

      insert into public.lignes_commande_marketplace (
        commande_id, produit_id, variante_id, nom_produit,
        nom_variante, image_url, prix_unitaire, quantite
      ) values (
        v_commande, v_ligne.produit_id, v_ligne.variante_id,
        v_ligne.produit_nom, v_ligne.variante_nom, v_ligne.images[1],
        v_ligne.prix, v_ligne.quantite
      );
      v_sous_total := v_sous_total + (v_ligne.prix * v_ligne.quantite);
    end loop;

    if v_sous_total = 0 then
      raise exception 'Une boutique du panier ne contient plus de produit disponible.';
    end if;

    update public.commandes_marketplace
    set sous_total = v_sous_total,
        total = v_sous_total
    where id = v_commande;
    v_total_achat := v_total_achat + v_sous_total;
  end loop;

  if v_total_achat = 0 then
    raise exception 'Aucun produit disponible dans le panier.';
  end if;

  update public.achats
  set sous_total = v_total_achat,
      frais_livraison = 0,
      total = v_total_achat,
      frais_livraison_a_confirmer = true
  where id = v_achat;

  insert into public.paiements_marketplace (
    achat_id, fournisseur, montant, cle_idempotence
  ) values (
    v_achat,
    p_mode_paiement,
    v_total_achat,
    v_achat::text || ':initial'
  );

  update public.paniers
  set statut = 'VALIDE',
      modifie_le = now()
  where id = v_panier;

  return v_achat;
end;
$$;

-- La validation publique historique utilisait les frais fixes du marchand.
-- Elle est fermee : seul l'Edge Function peut appeler la version tarifee.
revoke all on function public.rpc_valider_panier(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.rpc_valider_panier_tarife(uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.rpc_valider_panier_tarife(uuid, uuid, text, text, uuid, jsonb)
  to service_role;

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
  v_achat_id uuid;
  v_total_achat bigint;
  v_reste_a_confirmer boolean;
begin
  select commande_id into v_commande_id
  from public.missions_logistiques
  where id = p_mission_id
  for update;
  if v_commande_id is null then
    raise exception 'Mission IKMS introuvable.';
  end if;

  if not p_succes then
    update public.missions_logistiques
    set statut = 'ERREUR',
        derniere_erreur = left(coalesce(p_erreur, 'Erreur IKMS'), 2000),
        reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
        derniere_synchronisation = now()
    where id = p_mission_id;
    return jsonb_build_object('succes', false, 'commande_id', v_commande_id);
  end if;

  if nullif(trim(coalesce(p_commande_externe_id, '')), '') is null then
    raise exception 'Identifiant de commande IKMS manquant.';
  end if;
  if p_montant_livraison is null
     or p_montant_livraison < 0
     or p_montant_livraison > 5000000 then
    raise exception 'Montant de livraison IKMS invalide.';
  end if;

  update public.missions_logistiques
  set statut = 'ENVOYEE',
      statut_ikms = 'CREE',
      commande_livraison_externe_id = trim(p_commande_externe_id),
      code_ramassage = p_code_ramassage,
      id_colis = p_id_colis,
      code_livraison = p_code_livraison,
      montant_livraison = p_montant_livraison,
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_erreur = null,
      derniere_synchronisation = now()
  where id = p_mission_id;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
  perform set_config('ikigai.change_par', coalesce(p_acteur_id::text, ''), true);
  update public.commandes_marketplace
  set statut = 'EN_LIVRAISON',
      frais_livraison = p_montant_livraison,
      total = sous_total + p_montant_livraison,
      frais_livraison_a_confirmer = false
  where id = v_commande_id
    and statut = 'PRETE'
  returning achat_id into v_achat_id;

  if v_achat_id is not null then
    select
      coalesce(sum(total), 0),
      coalesce(bool_or(
        frais_livraison_a_confirmer and statut <> 'ANNULEE'
      ), false)
    into v_total_achat, v_reste_a_confirmer
    from public.commandes_marketplace
    where achat_id = v_achat_id;

    update public.achats
    set frais_livraison = (
          select coalesce(sum(frais_livraison), 0)
          from public.commandes_marketplace
          where achat_id = v_achat_id
        ),
        total = v_total_achat,
        frais_livraison_a_confirmer = v_reste_a_confirmer
    where id = v_achat_id;

    update public.paiements_marketplace
    set montant = v_total_achat
    where achat_id = v_achat_id
      and fournisseur = 'A_LA_LIVRAISON'
      and statut = 'INITIE';
  end if;

  return jsonb_build_object(
    'succes', true,
    'commande_id', v_commande_id,
    'commande_livraison_id', trim(p_commande_externe_id),
    'montant_livraison', p_montant_livraison
  );
end;
$$;

revoke all on function public.rpc_finaliser_mission_ikms(
  uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text
) from public, anon, authenticated;
grant execute on function public.rpc_finaliser_mission_ikms(
  uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text
) to service_role;

-- Ferme aussi le risque par defaut pour les prochaines fonctions.
alter default privileges in schema public
  revoke execute on functions from public;
