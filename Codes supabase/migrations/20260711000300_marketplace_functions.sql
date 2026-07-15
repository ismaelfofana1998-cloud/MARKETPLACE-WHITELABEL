-- Fonctions transactionnelles Marketplace. Les prix et stocks sont recalcules
-- cote base : le navigateur ne peut jamais imposer un montant.

create or replace function public.rpc_ajouter_au_panier(
  p_variante_id uuid,
  p_quantite integer default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_panier uuid;
  v_stock integer;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if p_quantite < 1 or p_quantite > 99 then raise exception 'Quantite invalide.'; end if;

  select s.quantite into v_stock
  from public.stocks s
  join public.variantes_produit v on v.id = s.variante_id and v.actif
  join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
  join public.boutiques b on b.id = p.boutique_id and b.statut = 'PUBLIEE'
  where s.variante_id = p_variante_id;

  if v_stock is null then raise exception 'Produit indisponible.'; end if;
  if v_stock < p_quantite then raise exception 'Stock insuffisant.'; end if;

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF';

  if v_panier is null then
    insert into public.paniers (identite_id) values (v_utilisateur) returning id into v_panier;
  end if;

  insert into public.lignes_panier (panier_id, variante_id, quantite)
  values (v_panier, p_variante_id, p_quantite)
  on conflict (panier_id, variante_id)
  do update set quantite = least(99, public.lignes_panier.quantite + excluded.quantite);

  if (select quantite from public.lignes_panier where panier_id = v_panier and variante_id = p_variante_id) > v_stock then
    raise exception 'Stock insuffisant.';
  end if;
  return v_panier;
end;
$$;

create or replace function public.rpc_modifier_ligne_panier(
  p_ligne_id uuid,
  p_quantite integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_stock integer;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.lignes_panier l join public.paniers p on p.id = l.panier_id
    where l.id = p_ligne_id and p.identite_id = v_utilisateur and p.statut = 'ACTIF'
  ) then raise exception 'Ligne introuvable.' using errcode = '42501'; end if;

  if p_quantite <= 0 then
    delete from public.lignes_panier where id = p_ligne_id;
    return;
  end if;

  select s.quantite into v_stock
  from public.lignes_panier l join public.stocks s on s.variante_id = l.variante_id
  where l.id = p_ligne_id;
  if p_quantite > coalesce(v_stock, 0) then raise exception 'Stock insuffisant.'; end if;
  update public.lignes_panier set quantite = p_quantite where id = p_ligne_id;
end;
$$;

create or replace function public.rpc_valider_panier(
  p_adresse_id uuid,
  p_mode_paiement text,
  p_note text default null
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
  if not exists (select 1 from public.adresses_livraison where id = p_adresse_id and identite_id = v_utilisateur) then
    raise exception 'Adresse invalide.' using errcode = '42501';
  end if;

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF' for update;
  if v_panier is null or not exists (select 1 from public.lignes_panier where panier_id = v_panier) then
    raise exception 'Le panier est vide.';
  end if;

  v_reference := 'ACH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.achats (reference, acheteur_id, adresse_livraison_id, mode_paiement)
  values (v_reference, v_utilisateur, p_adresse_id, p_mode_paiement)
  returning id into v_achat;

  for v_boutique in
    select distinct b.id, b.frais_livraison_base
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    join public.boutiques b on b.id = p.boutique_id
    where lp.panier_id = v_panier and p.statut = 'ACTIF' and b.statut = 'PUBLIEE'
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
  set sous_total = v_total_achat, frais_livraison = v_frais_achat, total = v_total_achat + v_frais_achat
  where id = v_achat;

  insert into public.paiements_marketplace
    (achat_id, fournisseur, montant, cle_idempotence)
  values
    (v_achat, p_mode_paiement, v_total_achat + v_frais_achat, v_achat::text || ':initial');

  update public.paniers set statut = 'VALIDE' where id = v_panier;
  return v_achat;
end;
$$;

create or replace function public.rpc_changer_statut_commande_marketplace(
  p_commande_id uuid,
  p_nouveau_statut text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande public.commandes_marketplace%rowtype;
  v_autorise boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  select * into v_commande from public.commandes_marketplace where id = p_commande_id for update;
  if v_commande.id is null or not private.peut_gerer_boutique(v_commande.boutique_id) then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;

  v_autorise := case v_commande.statut
    when 'NOUVELLE' then p_nouveau_statut in ('CONFIRMEE', 'ANNULEE')
    when 'CONFIRMEE' then p_nouveau_statut in ('EN_PREPARATION', 'ANNULEE')
    when 'EN_PREPARATION' then p_nouveau_statut = 'PRETE'
    when 'PRETE' then p_nouveau_statut = 'EN_LIVRAISON'
    when 'EN_LIVRAISON' then p_nouveau_statut = 'LIVREE'
    else false end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  update public.commandes_marketplace set statut = p_nouveau_statut where id = p_commande_id;
end;
$$;

create or replace function public.rpc_creer_boutique_marketplace(
  p_organisation_id uuid,
  p_nom text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN']) then
    raise exception 'Droit administrateur requis.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id and type in ('MARCHAND', 'RESTAURANT')) then
    raise exception 'Cette organisation n''est pas marchande.';
  end if;
  insert into public.boutiques (organisation_id, nom, slug)
  values (p_organisation_id, trim(p_nom), lower(trim(p_slug)))
  returning id into v_boutique;
  return v_boutique;
end;
$$;

create or replace function public.rpc_creer_produit_marketplace(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_image_url text default null
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
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not private.peut_gerer_boutique(p_boutique_id) then raise exception 'Droit marchand requis.' using errcode = '42501'; end if;
  if p_prix < 0 or p_stock < 0 then raise exception 'Prix ou stock invalide.'; end if;
  v_slug := lower(regexp_replace(trim(p_nom), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.produits (boutique_id, nom, slug, prix, images, statut)
  values (p_boutique_id, trim(p_nom), v_slug, p_prix, case when p_image_url is null then array[]::text[] else array[p_image_url] end, 'ACTIF')
  returning id into v_produit;
  insert into public.variantes_produit (produit_id, sku, nom)
  values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
  returning id into v_variante;
  insert into public.stocks (variante_id, quantite) values (v_variante, p_stock);
  return v_produit;
end;
$$;

revoke all on function public.rpc_ajouter_au_panier(uuid, integer) from public, anon;
revoke all on function public.rpc_modifier_ligne_panier(uuid, integer) from public, anon;
revoke all on function public.rpc_valider_panier(uuid, text, text) from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text) from public, anon;
revoke all on function public.rpc_creer_boutique_marketplace(uuid, text, text) from public, anon;
revoke all on function public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text) from public, anon;
grant execute on function public.rpc_ajouter_au_panier(uuid, integer) to authenticated;
grant execute on function public.rpc_modifier_ligne_panier(uuid, integer) to authenticated;
grant execute on function public.rpc_valider_panier(uuid, text, text) to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text) to authenticated;
grant execute on function public.rpc_creer_boutique_marketplace(uuid, text, text) to authenticated;
grant execute on function public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text) to authenticated;
