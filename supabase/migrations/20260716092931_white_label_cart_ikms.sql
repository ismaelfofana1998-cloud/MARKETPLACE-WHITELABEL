-- Isolation des paniers et de la livraison IKMS par etablissement.

set search_path = public, extensions;

alter table public.paniers
  add column if not exists boutique_contexte_id uuid
    references public.boutiques(id) on delete cascade;

alter table public.achats
  add column if not exists boutique_contexte_id uuid
    references public.boutiques(id) on delete set null;

drop index if exists public.paniers_actif_identite_idx;
create unique index if not exists paniers_actif_marketplace_idx
  on public.paniers(identite_id)
  where statut = 'ACTIF' and boutique_contexte_id is null;
create unique index if not exists paniers_actif_vitrine_idx
  on public.paniers(identite_id, boutique_contexte_id)
  where statut = 'ACTIF' and boutique_contexte_id is not null;
create index if not exists paniers_contexte_idx
  on public.paniers(boutique_contexte_id, statut, modifie_le desc);
create index if not exists achats_boutique_contexte_idx
  on public.achats(boutique_contexte_id, cree_le desc)
  where boutique_contexte_id is not null;

-- Les ecritures de panier passent exclusivement par les RPC transactionnelles.
-- Cela empeche un client de changer lui-meme le contexte d'un Site dedie.
revoke insert, update, delete on public.paniers, public.lignes_panier from authenticated;
grant select on public.paniers, public.lignes_panier to authenticated;

create or replace function private.valider_ligne_panier_contexte()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique_contexte uuid;
  v_boutique_produit uuid;
begin
  select p.boutique_contexte_id into v_boutique_contexte
  from public.paniers p where p.id = new.panier_id;

  if v_boutique_contexte is not null then
    select pr.boutique_id into v_boutique_produit
    from public.variantes_produit v
    join public.produits pr on pr.id = v.produit_id
    where v.id = new.variante_id;

    if v_boutique_produit is distinct from v_boutique_contexte then
      raise exception 'Ce produit appartient a un autre Site dedie.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lignes_panier_valider_contexte on public.lignes_panier;
create trigger lignes_panier_valider_contexte
before insert or update of panier_id, variante_id on public.lignes_panier
for each row execute function private.valider_ligne_panier_contexte();

revoke all on function private.valider_ligne_panier_contexte() from public, anon, authenticated;

drop function if exists public.rpc_ajouter_au_panier(uuid, integer);
create function public.rpc_ajouter_au_panier(
  p_variante_id uuid,
  p_quantite integer default 1,
  p_boutique_contexte_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_panier uuid;
  v_stock integer;
  v_boutique_produit uuid;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if p_quantite < 1 or p_quantite > 99 then raise exception 'Quantite invalide.'; end if;

  select s.quantite, p.boutique_id into v_stock, v_boutique_produit
  from public.stocks s
  join public.variantes_produit v on v.id = s.variante_id and v.actif
  join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
  join public.boutiques b on b.id = p.boutique_id and b.statut = 'PUBLIEE'
  where s.variante_id = p_variante_id;

  if v_stock is null then raise exception 'Produit indisponible.'; end if;
  if v_stock < p_quantite then raise exception 'Stock insuffisant.'; end if;
  if p_boutique_contexte_id is not null and v_boutique_produit <> p_boutique_contexte_id then
    raise exception 'Ce produit appartient a un autre Site dedie.' using errcode = '42501';
  end if;
  if p_boutique_contexte_id is not null and not exists (
    select 1 from public.boutiques b
    join public.offres_organisations o on o.organisation_id = b.organisation_id
    where b.id = p_boutique_contexte_id and b.statut = 'PUBLIEE'
      and b.mode_vitrine = 'WHITE_LABEL'
      and o.offre = 'WHITE_LABEL' and o.white_label_actif and o.active
  ) then
    raise exception 'Site dedie indisponible.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_utilisateur::text || ':' || coalesce(p_boutique_contexte_id::text, 'MARKETPLACE'), 0
  ));

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF'
    and boutique_contexte_id is not distinct from p_boutique_contexte_id
  for update;

  if v_panier is null then
    insert into public.paniers (identite_id, boutique_contexte_id)
    values (v_utilisateur, p_boutique_contexte_id)
    returning id into v_panier;
  end if;

  insert into public.lignes_panier (panier_id, variante_id, quantite)
  values (v_panier, p_variante_id, p_quantite)
  on conflict (panier_id, variante_id)
  do update set quantite = least(99, public.lignes_panier.quantite + excluded.quantite);

  if (select quantite from public.lignes_panier where panier_id = v_panier and variante_id = p_variante_id) > v_stock then
    raise exception 'Stock insuffisant.';
  end if;
  update public.paniers set modifie_le = now() where id = v_panier;
  return v_panier;
end;
$$;

drop function if exists public.rpc_valider_panier(uuid, text, text);
create function public.rpc_valider_panier(
  p_adresse_id uuid,
  p_mode_paiement text,
  p_note text default null,
  p_boutique_contexte_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_panier uuid;
  v_achat uuid;
  v_commande uuid;
  v_boutique record;
  v_ligne record;
  v_sous_total bigint;
  v_total_achat bigint := 0;
  v_frais_achat bigint := 0;
  v_reference text;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if p_mode_paiement not in ('WAVE', 'ORANGE_MONEY', 'CARTE', 'A_LA_LIVRAISON') then
    raise exception 'Mode de paiement invalide.';
  end if;
  if not exists (
    select 1 from public.adresses_livraison
    where id = p_adresse_id and identite_id = v_utilisateur
  ) then
    raise exception 'Adresse invalide.' using errcode = '42501';
  end if;

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF'
    and boutique_contexte_id is not distinct from p_boutique_contexte_id
  for update;
  if v_panier is null or not exists (select 1 from public.lignes_panier where panier_id = v_panier) then
    raise exception 'Le panier est vide.';
  end if;
  if p_boutique_contexte_id is not null and exists (
    select 1 from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    where lp.panier_id = v_panier and p.boutique_id <> p_boutique_contexte_id
  ) then
    raise exception 'Le panier contient un produit d''un autre Site dedie.' using errcode = '42501';
  end if;

  v_reference := 'ACH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.achats (
    reference, acheteur_id, adresse_livraison_id, mode_paiement, boutique_contexte_id
  ) values (
    v_reference, v_utilisateur, p_adresse_id, p_mode_paiement, p_boutique_contexte_id
  ) returning id into v_achat;

  for v_boutique in
    select distinct b.id, b.frais_livraison_base
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    join public.boutiques b on b.id = p.boutique_id
    where lp.panier_id = v_panier and p.statut = 'ACTIF' and b.statut = 'PUBLIEE'
      and (p_boutique_contexte_id is null or b.id = p_boutique_contexte_id)
  loop
    v_sous_total := 0;
    insert into public.commandes_marketplace
      (achat_id, boutique_id, reference, frais_livraison, note_client)
    values
      (v_achat, v_boutique.id, 'CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), v_boutique.frais_livraison_base, p_note)
    returning id into v_commande;

    for v_ligne in
      select lp.quantite, v.id as variante_id, v.nom as variante_nom,
             p.id as produit_id, p.nom as produit_nom, p.images,
             coalesce(v.prix, p.prix) as prix, s.quantite as stock
      from public.lignes_panier lp
      join public.variantes_produit v on v.id = lp.variante_id and v.actif
      join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
      join public.stocks s on s.variante_id = v.id
      where lp.panier_id = v_panier and p.boutique_id = v_boutique.id
      for update of s
    loop
      if v_ligne.stock < v_ligne.quantite then
        raise exception 'Stock insuffisant pour %.', v_ligne.produit_nom;
      end if;
      update public.stocks set quantite = quantite - v_ligne.quantite, modifie_le = now()
      where variante_id = v_ligne.variante_id;
      insert into public.lignes_commande_marketplace
        (commande_id, produit_id, variante_id, nom_produit, nom_variante, image_url, prix_unitaire, quantite)
      values
        (v_commande, v_ligne.produit_id, v_ligne.variante_id, v_ligne.produit_nom,
         v_ligne.variante_nom, v_ligne.images[1], v_ligne.prix, v_ligne.quantite);
      v_sous_total := v_sous_total + (v_ligne.prix * v_ligne.quantite);
    end loop;

    if v_sous_total = 0 then raise exception 'Une boutique du panier ne contient plus de produit disponible.'; end if;
    update public.commandes_marketplace
    set sous_total = v_sous_total, total = v_sous_total + v_boutique.frais_livraison_base
    where id = v_commande;
    v_total_achat := v_total_achat + v_sous_total;
    v_frais_achat := v_frais_achat + v_boutique.frais_livraison_base;
  end loop;

  if v_total_achat = 0 then raise exception 'Aucun produit disponible dans le panier.'; end if;
  update public.achats
  set sous_total = v_total_achat, frais_livraison = v_frais_achat,
      total = v_total_achat + v_frais_achat
  where id = v_achat;
  insert into public.paiements_marketplace (achat_id, fournisseur, montant, cle_idempotence)
  values (v_achat, p_mode_paiement, v_total_achat + v_frais_achat, v_achat::text || ':initial');
  update public.paniers set statut = 'VALIDE', modifie_le = now() where id = v_panier;
  return v_achat;
end;
$$;

revoke all on function public.rpc_ajouter_au_panier(uuid, integer, uuid) from public, anon;
revoke all on function public.rpc_valider_panier(uuid, text, text, uuid) from public, anon;
grant execute on function public.rpc_ajouter_au_panier(uuid, integer, uuid) to authenticated;
grant execute on function public.rpc_valider_panier(uuid, text, text, uuid) to authenticated;

create table public.integrations_ikms_boutique (
  boutique_id uuid primary key references public.boutiques(id) on delete cascade,
  zone_depart text not null,
  expediteur_nom text not null,
  expediteur_tel text not null,
  expediteur_adresse text not null,
  mode_paiement text not null default 'SANS_PAIEMENT'
    check (mode_paiement in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR')),
  cle_api_configuree boolean not null default false,
  actif boolean not null default false,
  derniere_verification timestamptz,
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  check (zone_depart ~ '^[A-Z0-9_-]{2,50}$'),
  check (expediteur_tel ~ '^[0-9]{10}$')
);

drop trigger if exists integrations_ikms_boutique_toucher_modification on public.integrations_ikms_boutique;
create trigger integrations_ikms_boutique_toucher_modification
before update on public.integrations_ikms_boutique
for each row execute function private.toucher_modification();

alter table public.integrations_ikms_boutique enable row level security;
create policy integrations_ikms_boutique_gestionnaires
on public.integrations_ikms_boutique for select to authenticated
using (
  (select private.peut_gerer_boutique(boutique_id))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
);

grant select on public.integrations_ikms_boutique to authenticated;
revoke insert, update, delete on public.integrations_ikms_boutique from authenticated;

create or replace function public.rpc_configurer_integration_ikms_boutique(
  p_boutique_id uuid,
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
  v_secret_name text := 'ikms_api_key_boutique_' || p_boutique_id::text;
  v_cle_configuree boolean;
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
  if p_mode_paiement not in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR') then
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
    trim(p_expediteur_adresse), p_mode_paiement, v_cle_configuree, p_actif, null
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

create or replace function public.rpc_lire_integration_ikms_boutique(p_boutique_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with integration as (
    select
      i.boutique_id,
      i.actif,
      i.cle_api_configuree,
      i.zone_depart,
      i.expediteur_nom,
      i.expediteur_tel,
      i.expediteur_adresse,
      i.mode_paiement,
      'ikms_api_key_boutique_' || i.boutique_id::text as secret_name,
      0 as priorite
    from public.integrations_ikms_boutique i
    where i.boutique_id = p_boutique_id

    union all

    select
      b.id,
      i.actif,
      i.cle_api_configuree,
      i.zone_depart,
      i.expediteur_nom,
      i.expediteur_tel,
      i.expediteur_adresse,
      i.mode_paiement,
      'ikms_api_key_' || i.organisation_id::text,
      1
    from public.boutiques b
    join public.integrations_livraison i on i.organisation_id = b.organisation_id
    where b.id = p_boutique_id
      and b.mode_vitrine = 'MARKETPLACE'
      and not exists (
        select 1 from public.integrations_ikms_boutique propre
        where propre.boutique_id = b.id
      )
  )
  select jsonb_build_object(
    'boutique_id', i.boutique_id,
    'actif', i.actif,
    'cle_api_configuree', i.cle_api_configuree,
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
  from integration i
  cross join public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = i.secret_name
  where c.id = 1
  order by i.priorite
  limit 1;
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
  select
    c.id,
    c.statut,
    coalesce(cfg.ikms_tenant_code, org.code_entreprise_livraison) as code_entreprise_livraison,
    org.compte_pro_externe_id
  into v_commande
  from public.commandes_marketplace c
  join public.boutiques b on b.id = c.boutique_id
  left join public.integrations_ikms_boutique propre on propre.boutique_id = c.boutique_id
  left join public.integrations_livraison org
    on org.organisation_id = b.organisation_id
   and b.mode_vitrine = 'MARKETPLACE'
   and propre.boutique_id is null
  cross join public.configuration_marketplace cfg
  where c.id = p_commande_id
    and cfg.id = 1
    and coalesce(propre.actif, org.actif, false)
    and coalesce(propre.cle_api_configuree, org.cle_api_configuree, false)
  for update of c;

  if v_commande.id is null then raise exception 'Commande ou integration IKMS indisponible.'; end if;
  insert into public.missions_logistiques (
    commande_id, entreprise_livraison_code, compte_pro_externe_id, payload
  ) values (
    p_commande_id, v_commande.code_entreprise_livraison,
    v_commande.compte_pro_externe_id, coalesce(p_payload, '{}'::jsonb)
  ) on conflict (commande_id) do nothing;
  select * into v_mission from public.missions_logistiques
  where commande_id = p_commande_id for update;

  if v_mission.commande_livraison_externe_id is not null then
    return jsonb_build_object(
      'envoyer', false, 'mission_id', v_mission.id,
      'commande_livraison_id', v_mission.commande_livraison_externe_id
    );
  end if;
  if v_commande.statut <> 'PRETE' then raise exception 'La commande doit etre prete avant transmission.'; end if;
  if v_mission.statut = 'ENVOI_EN_COURS' and v_mission.modifie_le > now() - interval '2 minutes' then
    raise exception 'La transmission IKMS est deja en cours.';
  end if;
  update public.missions_logistiques
  set statut = 'ENVOI_EN_COURS', payload = coalesce(p_payload, '{}'::jsonb),
      tentatives = tentatives + 1, derniere_erreur = null
  where id = v_mission.id;
  return jsonb_build_object('envoyer', true, 'mission_id', v_mission.id);
end;
$$;

revoke all on function public.rpc_configurer_integration_ikms_boutique(uuid, text, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.rpc_configurer_integration_ikms_boutique(uuid, text, text, text, text, text, text, boolean)
  to authenticated;
revoke all on function public.rpc_lire_integration_ikms_boutique(uuid) from public, anon, authenticated;
grant execute on function public.rpc_lire_integration_ikms_boutique(uuid) to service_role;
revoke all on function public.rpc_reclamer_mission_ikms(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_reclamer_mission_ikms(uuid, jsonb) to service_role;

-- Soum Cosmetique devient le premier Site dedie lorsqu'elle existe deja dans
-- les donnees migrees. Aucun identifiant genere n'est fige dans la migration.
do $$
declare
  v_boutique record;
  v_max_etablissements integer;
begin
  for v_boutique in
    select b.id, b.organisation_id, b.nom, b.description, b.logo_url, b.banniere_url
    from public.boutiques b
    join public.organisations o on o.id = b.organisation_id
    where b.slug in ('soum-cosmetique', 'soum-cosmetics')
       or o.slug in ('soum-cosmetique', 'soum-cosmetics')
       or public.normaliser_recherche_marketplace(b.nom) = 'soum cosmetique'
       or public.normaliser_recherche_marketplace(o.nom) = 'soum cosmetique'
  loop
    select greatest(1, count(*))::integer into v_max_etablissements
    from public.boutiques
    where organisation_id = v_boutique.organisation_id;

    update public.offres_organisations
    set offre = 'WHITE_LABEL',
        white_label_actif = true,
        domaines_personnalises = true,
        max_etablissements = greatest(max_etablissements, v_max_etablissements),
        active = true,
        modifie_le = now()
    where organisation_id = v_boutique.organisation_id;

    update public.boutiques
    set mode_vitrine = 'WHITE_LABEL'
    where id = v_boutique.id;

    insert into public.configurations_boutique (
      boutique_id, nom_site, slogan, description, annonce, logo_url,
      hero_images, couleur_primaire, couleur_secondaire, couleur_accent,
      masquer_autres_boutiques, masquer_categories_globales,
      afficher_signature_plateforme
    ) values (
      v_boutique.id,
      'Soum Cosmetique',
      'La beaute qui vous ressemble.',
      v_boutique.description,
      'Bienvenue sur le Site dedie Soum Cosmetique',
      v_boutique.logo_url,
      array_remove(array[v_boutique.banniere_url], null),
      '#A65A66', '#24191C', '#D8A48F',
      true, true, false
    )
    on conflict (boutique_id) do update set
      nom_site = coalesce(public.configurations_boutique.nom_site, excluded.nom_site),
      slogan = coalesce(public.configurations_boutique.slogan, excluded.slogan),
      description = coalesce(public.configurations_boutique.description, excluded.description),
      annonce = coalesce(public.configurations_boutique.annonce, excluded.annonce),
      logo_url = coalesce(public.configurations_boutique.logo_url, excluded.logo_url),
      hero_images = case
        when cardinality(public.configurations_boutique.hero_images) = 0 then excluded.hero_images
        else public.configurations_boutique.hero_images
      end,
      masquer_autres_boutiques = true,
      masquer_categories_globales = true,
      afficher_signature_plateforme = false,
      modifie_le = now();

    insert into public.categories_boutique (
      boutique_id, nom, slug, description, image_url, ordre, actif
    )
    select distinct
      v_boutique.id, c.nom, c.slug, c.description, c.image_url, c.ordre, c.actif
    from public.produits p
    join public.categories_marketplace c on c.id = p.categorie_id
    where p.boutique_id = v_boutique.id
    on conflict (boutique_id, slug) do update set
      nom = excluded.nom,
      description = excluded.description,
      image_url = excluded.image_url,
      ordre = excluded.ordre,
      actif = excluded.actif,
      modifie_le = now();

    update public.produits p
    set categorie_boutique_id = cb.id
    from public.categories_marketplace cm
    join public.categories_boutique cb
      on cb.boutique_id = v_boutique.id and cb.slug = cm.slug
    where p.boutique_id = v_boutique.id
      and p.categorie_id = cm.id
      and p.categorie_boutique_id is null;
  end loop;
end $$;
