-- La zone de ramassage appartient au profil commercial de la boutique.
-- Elle reste disponible pour l'estimation, meme avant l'activation de la cle
-- client pro qui servira uniquement a transmettre la commande a IKMS.
alter table public.boutiques
  add column if not exists zone_ramassage text,
  add column if not exists livraison_incluse_prix boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'boutiques_zone_ramassage_check'
      and conrelid = 'public.boutiques'::regclass
  ) then
    alter table public.boutiques
      add constraint boutiques_zone_ramassage_check
      check (
        zone_ramassage is null
        or zone_ramassage ~ '^[A-Z0-9_-]{2,50}$'
      );
  end if;
end;
$$;

update public.boutiques b
set zone_ramassage = i.zone_depart
from public.integrations_ikms_boutique i
where i.boutique_id = b.id
  and b.zone_ramassage is null;

create or replace function private.synchroniser_zone_ramassage_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.boutiques
  set zone_ramassage = new.zone_depart,
      modifie_le = now()
  where id = new.boutique_id;
  return new;
end;
$$;

drop trigger if exists integrations_ikms_boutique_synchroniser_zone
on public.integrations_ikms_boutique;
create trigger integrations_ikms_boutique_synchroniser_zone
after insert or update of zone_depart on public.integrations_ikms_boutique
for each row execute function private.synchroniser_zone_ramassage_boutique();

revoke all on function private.synchroniser_zone_ramassage_boutique()
  from public, anon, authenticated, service_role;

create or replace function public.rpc_configurer_tarification_livraison_boutique(
  p_boutique_id uuid,
  p_livraison_incluse_prix boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (
       not private.peut_gerer_boutique(p_boutique_id)
       and not private.est_admin_plateforme(array['SUPER_ADMIN'])
     ) then
    raise exception 'Droit administrateur marchand requis.' using errcode = '42501';
  end if;

  update public.boutiques
  set livraison_incluse_prix = coalesce(p_livraison_incluse_prix, false),
      modifie_le = now()
  where id = p_boutique_id;

  if not found then raise exception 'Boutique introuvable.'; end if;
  return jsonb_build_object(
    'boutique_id', p_boutique_id,
    'livraison_incluse_prix', coalesce(p_livraison_incluse_prix, false)
  );
end;
$$;

revoke all on function public.rpc_configurer_tarification_livraison_boutique(uuid, boolean)
  from public, anon;
grant execute on function public.rpc_configurer_tarification_livraison_boutique(uuid, boolean)
  to authenticated;

-- Le montant facture au client et le cout logistique IKMS sont volontairement
-- separes. Le second sert a la facturation ulterieure du marchand et n'est
-- jamais transforme en supplement client apres paiement.
alter table public.commandes_marketplace
  add column if not exists cout_livraison_ikms bigint not null default 0,
  add column if not exists cout_livraison_ikms_definitif boolean not null default false,
  add column if not exists livraison_incluse_prix boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'commandes_marketplace_cout_livraison_ikms_check'
      and conrelid = 'public.commandes_marketplace'::regclass
  ) then
    alter table public.commandes_marketplace
      add constraint commandes_marketplace_cout_livraison_ikms_check
      check (cout_livraison_ikms between 0 and 5000000);
  end if;
end;
$$;

comment on column public.commandes_marketplace.frais_livraison is
  'Frais affiches et factures au client au checkout. Peut valoir zero si le marchand les inclut dans ses prix.';
comment on column public.commandes_marketplace.cout_livraison_ikms is
  'Cout logistique interne estime puis remplace par colis[].montant_livraison renvoye par IKMS. Sert a facturer le marchand.';
comment on column public.commandes_marketplace.cout_livraison_ikms_definitif is
  'Vrai lorsque POST /commandes IKMS a confirme le cout logistique interne.';

alter table public.paiements_marketplace
  add column if not exists commande_id uuid,
  add column if not exists boutique_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'paiements_marketplace_commande_id_fkey'
      and conrelid = 'public.paiements_marketplace'::regclass
  ) then
    alter table public.paiements_marketplace
      add constraint paiements_marketplace_commande_id_fkey
      foreign key (commande_id) references public.commandes_marketplace(id)
      on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'paiements_marketplace_boutique_id_fkey'
      and conrelid = 'public.paiements_marketplace'::regclass
  ) then
    alter table public.paiements_marketplace
      add constraint paiements_marketplace_boutique_id_fkey
      foreign key (boutique_id) references public.boutiques(id);
  end if;
end;
$$;

create index if not exists paiements_marketplace_commande_id_idx
  on public.paiements_marketplace(commande_id)
  where commande_id is not null;
create index if not exists paiements_marketplace_boutique_id_idx
  on public.paiements_marketplace(boutique_id)
  where boutique_id is not null;

alter table public.configurations_wave_organisation
  add column if not exists jeton_webhook uuid not null default gen_random_uuid();
create unique index if not exists configurations_wave_organisation_jeton_webhook_idx
  on public.configurations_wave_organisation(jeton_webhook);

create or replace function public.rpc_lire_configuration_wave_boutique(
  p_boutique_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'boutique_id', b.id,
    'boutique_nom', b.nom,
    'organisation_id', b.organisation_id,
    'actif', w.actif,
    'api_key', api.decrypted_secret,
    'signing_secret', signature.decrypted_secret,
    'jeton_webhook', w.jeton_webhook
  )
  from public.boutiques b
  join public.configurations_wave_organisation w
    on w.organisation_id = b.organisation_id
  left join vault.decrypted_secrets api
    on api.name = 'wave_api_key_organisation_' || b.organisation_id::text
  left join vault.decrypted_secrets signature
    on signature.name = 'wave_signing_secret_organisation_' || b.organisation_id::text
  where b.id = p_boutique_id;
$$;

create or replace function public.rpc_lire_configuration_wave_webhook(
  p_jeton_webhook uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organisation_id', w.organisation_id,
    'actif', w.actif,
    'signing_secret', signature.decrypted_secret
  )
  from public.configurations_wave_organisation w
  left join vault.decrypted_secrets signature
    on signature.name = 'wave_signing_secret_organisation_' || w.organisation_id::text
  where w.jeton_webhook = p_jeton_webhook;
$$;

revoke all on function public.rpc_lire_configuration_wave_boutique(uuid)
  from public, anon, authenticated;
grant execute on function public.rpc_lire_configuration_wave_boutique(uuid)
  to service_role;
revoke all on function public.rpc_lire_configuration_wave_webhook(uuid)
  from public, anon, authenticated;
grant execute on function public.rpc_lire_configuration_wave_webhook(uuid)
  to service_role;

create or replace function public.rpc_enregistrer_etat_paiement_wave(
  p_paiement_id uuid,
  p_succes boolean,
  p_reference text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paiement public.paiements_marketplace%rowtype;
  v_tout_paye boolean;
begin
  select * into v_paiement
  from public.paiements_marketplace
  where id = p_paiement_id
    and fournisseur = 'WAVE'
  for update;

  if v_paiement.id is null then raise exception 'Paiement Wave introuvable.'; end if;
  if v_paiement.statut = 'CONFIRME' and p_succes then
    return jsonb_build_object('paiement_id', v_paiement.id, 'duplique', true);
  end if;

  update public.paiements_marketplace
  set statut = case when p_succes then 'CONFIRME' else 'ECHOUE' end,
      reference_fournisseur = coalesce(nullif(trim(coalesce(p_reference, '')), ''), reference_fournisseur),
      payload = coalesce(p_payload, '{}'::jsonb),
      confirme_le = case when p_succes then now() else null end
  where id = v_paiement.id;

  if p_succes and v_paiement.commande_id is not null then
    perform set_config('ikigai.source_statut', 'SYSTEME', true);
    update public.commandes_marketplace
    set statut = 'CONFIRMEE', modifie_le = now()
    where id = v_paiement.commande_id
      and statut = 'NOUVELLE';
  end if;

  select not exists (
    select 1
    from public.paiements_marketplace
    where achat_id = v_paiement.achat_id
      and fournisseur = 'WAVE'
      and statut <> 'CONFIRME'
  ) into v_tout_paye;

  update public.achats
  set statut_paiement = case when v_tout_paye then 'PAYE' else 'EN_ATTENTE' end
  where id = v_paiement.achat_id;

  return jsonb_build_object(
    'paiement_id', v_paiement.id,
    'achat_id', v_paiement.achat_id,
    'confirme', p_succes,
    'achat_paye', v_tout_paye
  );
end;
$$;

revoke all on function public.rpc_enregistrer_etat_paiement_wave(uuid, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.rpc_enregistrer_etat_paiement_wave(uuid, boolean, text, jsonb)
  to service_role;

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
  v_frais_total bigint := 0;
  v_cout_ikms bigint;
  v_frais_client bigint;
  v_frais_texte text;
  v_reference text;
begin
  if p_acheteur_id is null then raise exception 'Acheteur requis.'; end if;
  if p_mode_paiement not in ('A_LA_LIVRAISON', 'WAVE') then
    raise exception 'Mode de paiement indisponible.';
  end if;
  if jsonb_typeof(coalesce(p_frais_par_boutique, '{}'::jsonb)) <> 'object' then
    raise exception 'Estimations de livraison invalides.';
  end if;
  if not exists (
    select 1 from public.adresses_livraison
    where id = p_adresse_id
      and identite_id = p_acheteur_id
      and nullif(trim(code_zone), '') is not null
  ) then
    raise exception 'Adresse ou zone de livraison invalide.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_acheteur_id::text || ':' || coalesce(p_boutique_contexte_id::text, 'MARKETPLACE'), 0
  ));

  select id into v_panier
  from public.paniers
  where identite_id = p_acheteur_id
    and statut = 'ACTIF'
    and boutique_contexte_id is not distinct from p_boutique_contexte_id
  for update;

  if v_panier is null or not exists (
    select 1 from public.lignes_panier where panier_id = v_panier
  ) then raise exception 'Le panier est vide.'; end if;

  if p_boutique_contexte_id is not null and exists (
    select 1
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    where lp.panier_id = v_panier
      and p.boutique_id <> p_boutique_contexte_id
  ) then
    raise exception 'Le panier contient un produit d''un autre Site dedie.' using errcode = '42501';
  end if;

  v_reference := 'ACH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.achats (
    reference, acheteur_id, adresse_livraison_id, mode_paiement,
    boutique_contexte_id, frais_livraison_a_confirmer
  ) values (
    v_reference, p_acheteur_id, p_adresse_id, p_mode_paiement,
    p_boutique_contexte_id, false
  ) returning id into v_achat;

  for v_boutique in
    select distinct
      b.id,
      b.organisation_id,
      b.livraison_incluse_prix,
      coalesce(w.actif and w.api_key_configuree and w.signing_secret_configure, false) as wave_actif
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    join public.boutiques b on b.id = p.boutique_id
    left join public.configurations_wave_organisation w
      on w.organisation_id = b.organisation_id
    where lp.panier_id = v_panier
      and p.statut = 'ACTIF'
      and b.statut = 'PUBLIEE'
      and (p_boutique_contexte_id is null or b.id = p_boutique_contexte_id)
  loop
    if p_mode_paiement = 'WAVE' and not v_boutique.wave_actif then
      raise exception 'Wave n''est pas configure pour toutes les boutiques du panier.';
    end if;

    v_frais_texte := p_frais_par_boutique ->> v_boutique.id::text;
    if v_frais_texte is null
       or v_frais_texte !~ '^[0-9]+$'
       or v_frais_texte::numeric > 5000000 then
      raise exception 'Le tarif de livraison est indisponible pour une boutique.';
    end if;
    v_cout_ikms := v_frais_texte::bigint;
    v_frais_client := case when v_boutique.livraison_incluse_prix then 0 else v_cout_ikms end;

    insert into public.commandes_marketplace (
      achat_id, boutique_id, reference, frais_livraison,
      frais_livraison_a_confirmer, cout_livraison_ikms,
      cout_livraison_ikms_definitif, livraison_incluse_prix, note_client
    ) values (
      v_achat, v_boutique.id,
      'CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      v_frais_client, false, v_cout_ikms, false,
      v_boutique.livraison_incluse_prix,
      nullif(trim(coalesce(p_note, '')), '')
    ) returning id into v_commande;

    v_sous_total := 0;
    for v_ligne in
      select lp.quantite, v.id as variante_id, v.nom as variante_nom,
        p.id as produit_id, p.nom as produit_nom, p.images,
        coalesce(v.prix, p.prix) as prix, s.quantite as stock
      from public.lignes_panier lp
      join public.variantes_produit v on v.id = lp.variante_id and v.actif
      join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
      join public.stocks s on s.variante_id = v.id
      where lp.panier_id = v_panier
        and p.boutique_id = v_boutique.id
      for update of s
    loop
      if v_ligne.stock < v_ligne.quantite then
        raise exception 'Stock insuffisant pour %.', v_ligne.produit_nom;
      end if;
      update public.stocks
      set quantite = quantite - v_ligne.quantite, modifie_le = now()
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
        total = v_sous_total + v_frais_client
    where id = v_commande;

    insert into public.paiements_marketplace (
      achat_id, commande_id, boutique_id, fournisseur,
      montant, cle_idempotence
    ) values (
      v_achat, v_commande, v_boutique.id, p_mode_paiement,
      v_sous_total + v_frais_client, v_commande::text || ':initial'
    );

    v_total_achat := v_total_achat + v_sous_total + v_frais_client;
    v_frais_total := v_frais_total + v_frais_client;
  end loop;

  if v_total_achat = 0 then raise exception 'Aucun produit disponible dans le panier.'; end if;

  update public.achats
  set sous_total = v_total_achat - v_frais_total,
      frais_livraison = v_frais_total,
      total = v_total_achat,
      frais_livraison_a_confirmer = false
  where id = v_achat;

  update public.paniers
  set statut = 'VALIDE', modifie_le = now()
  where id = v_panier;

  return v_achat;
end;
$$;

revoke all on function public.rpc_valider_panier_tarife(uuid, uuid, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.rpc_valider_panier_tarife(uuid, uuid, text, text, uuid, jsonb)
  to service_role;

-- Le tarif definitif d'IKMS sert uniquement a la facture logistique interne.
-- Le montant affiche puis paye par le client au checkout ne change jamais ici.
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
  set statut = 'ENVOYEE', statut_ikms = 'CREE',
      commande_livraison_externe_id = trim(p_commande_externe_id),
      code_ramassage = p_code_ramassage, id_colis = p_id_colis,
      code_livraison = p_code_livraison,
      montant_livraison = p_montant_livraison,
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_erreur = null, derniere_synchronisation = now()
  where id = p_mission_id;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
  perform set_config('ikigai.change_par', coalesce(p_acteur_id::text, ''), true);
  update public.commandes_marketplace
  set statut = 'EN_LIVRAISON',
      cout_livraison_ikms = p_montant_livraison,
      cout_livraison_ikms_definitif = true,
      frais_livraison_a_confirmer = false,
      modifie_le = now()
  where id = v_commande_id
    and statut = 'PRETE';

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

alter default privileges in schema public
  revoke execute on functions from public;
