begin;

do $$
declare
  v_admin uuid := '20000000-0000-0000-0000-000000000001';
  v_marchand uuid := '20000000-0000-0000-0000-000000000002';
  v_client uuid := '20000000-0000-0000-0000-000000000003';
  v_intrus uuid := '20000000-0000-0000-0000-000000000004';
  v_tenant jsonb;
  v_organisation uuid;
  v_boutique_a uuid;
  v_boutique_b uuid;
  v_categorie_a uuid;
  v_categorie_b uuid;
  v_produit_a uuid;
  v_produit_b uuid;
  v_variante_a uuid;
  v_variante_b uuid;
  v_resolution jsonb;
  v_adresse uuid;
  v_achat uuid;
  v_nombre integer;
begin
  insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  values
    (v_admin, 'admin-whitelabel-smoke@ikigai.test', '{}', now(), now()),
    (v_marchand, 'marchand-whitelabel-smoke@ikigai.test', '{}', now(), now()),
    (v_client, 'client-whitelabel-smoke@ikigai.test', '{}', now(), now()),
    (v_intrus, 'intrus-whitelabel-smoke@ikigai.test', '{}', now(), now());

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  insert into public.administrateurs_plateforme (identite_id, role, actif)
  values (v_admin, 'SUPER_ADMIN', true);
  v_tenant := public.rpc_admin_creer_tenant(
    'Soum Cosmetique Smoke', 'soum-cosmetique-smoke', 'MARCHAND',
    'marchand-whitelabel-smoke@ikigai.test', true
  );
  v_organisation := (v_tenant ->> 'organisation_id')::uuid;
  v_boutique_a := (v_tenant ->> 'boutique_id')::uuid;
  perform public.rpc_admin_definir_offre_organisation(v_organisation, 'WHITE_LABEL', 2, true);

  perform set_config('request.jwt.claim.sub', v_marchand::text, true);
  perform public.rpc_accepter_invitation((v_tenant ->> 'token')::uuid);
  v_boutique_b := public.rpc_creer_boutique_marketplace(
    v_organisation, 'Soum Deuxieme', 'soum-deuxieme-smoke'
  );

  insert into public.categories_boutique (boutique_id, nom, slug, ordre)
  values (v_boutique_a, 'Soins visage', 'soins-visage', 1)
  returning id into v_categorie_a;
  insert into public.categories_boutique (boutique_id, nom, slug, ordre)
  values (v_boutique_b, 'Parfums', 'parfums', 1)
  returning id into v_categorie_b;

  insert into public.configurations_boutique (
    boutique_id, nom_site, slogan, hero_images, couleur_primaire,
    masquer_autres_boutiques, masquer_categories_globales
  ) values (
    v_boutique_a, 'Soum Cosmetique', 'La beaute qui vous ressemble',
    array['https://example.test/soum-hero.webp'], '#A65A66', true, true
  ) on conflict (boutique_id) do update set nom_site = excluded.nom_site;

  v_produit_a := public.rpc_enregistrer_produit_vitrine(
    v_boutique_a, 'Serum Soum', 9000, 10, null, null, v_categorie_a,
    'Serum de test', 'Soum', array['https://example.test/serum.webp'], 'ACTIF'
  );
  v_produit_b := public.rpc_enregistrer_produit_vitrine(
    v_boutique_b, 'Parfum Soum', 15000, 8, null, null, v_categorie_b,
    'Parfum de test', 'Soum', array['https://example.test/parfum.webp'], 'ACTIF'
  );
  select id into v_variante_a from public.variantes_produit where produit_id = v_produit_a limit 1;
  select id into v_variante_b from public.variantes_produit where produit_id = v_produit_b limit 1;

  v_resolution := public.rpc_resoudre_vitrine('soum-cosmetique-smoke', null);
  if (v_resolution #>> '{boutique,id}')::uuid <> v_boutique_a then
    raise exception 'Resolution de l''URL du Site dedie invalide';
  end if;
  select count(*) into v_nombre from public.rpc_rechercher_produits_vitrine(
    v_boutique_a, 'serum', v_categorie_a, null, null, null, true,
    'PERTINENCE', 1, 24
  );
  if v_nombre <> 1 then raise exception 'Catalogue du Site dedie non isole'; end if;

  perform set_config('request.jwt.claim.sub', v_client::text, true);
  perform public.rpc_ajouter_au_panier(v_variante_a, 1, v_boutique_a);
  perform public.rpc_ajouter_au_panier(v_variante_b, 1, v_boutique_b);
  select count(*) into v_nombre from public.paniers
  where identite_id = v_client and statut = 'ACTIF';
  if v_nombre <> 2 then raise exception 'Deux paniers de Sites dedies attendus, obtenu %', v_nombre; end if;

  begin
    perform public.rpc_ajouter_au_panier(v_variante_b, 1, v_boutique_a);
    raise exception 'Le croisement de paniers aurait du etre refuse';
  exception when insufficient_privilege or check_violation then
    null;
  end;

  insert into public.adresses_livraison (
    identite_id, libelle, destinataire_nom, telephone, adresse,
    commune, code_zone, principale
  ) values (
    v_client, 'Domicile', 'Client Smoke', '0700000000',
    'Adresse de test', 'Cocody', 'COCODY', true
  ) returning id into v_adresse;

  v_achat := public.rpc_valider_panier_tarife(
    v_client,
    v_adresse,
    'A_LA_LIVRAISON',
    'Tarif smoke',
    v_boutique_a,
    jsonb_build_object(v_boutique_a::text, 1500)
  );
  if not exists (
    select 1 from public.commandes_marketplace
    where achat_id = v_achat
      and boutique_id = v_boutique_a
      and frais_livraison = 0
      and total = sous_total
      and frais_livraison_a_confirmer
  ) then
    raise exception 'L''estimation IKMS ne doit pas etre facturee avant POST /commandes';
  end if;
  if exists (
    select 1
    from public.paiements_marketplace p
    join public.achats a on a.id = p.achat_id
    where p.achat_id = v_achat
      and p.montant <> a.sous_total
  ) then
    raise exception 'Le paiement provisoire contient une estimation de livraison';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
set local role authenticated;
do $$
declare
  v_modifie integer;
begin
  update public.configurations_boutique set slogan = 'Intrusion';
  get diagnostics v_modifie = row_count;
  if v_modifie <> 0 then raise exception 'RLS : un tiers a modifie un theme'; end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$
declare
  v_nombre integer;
begin
  select count(*) into v_nombre
  from public.rpc_rechercher_produits_vitrine(
    (public.rpc_resoudre_vitrine('soum-cosmetique-smoke', null) #>> '{boutique,id}')::uuid,
    null, null, null, null, null, false, 'NOUVEAUTES', 1, 24
  );
  if v_nombre <> 1 then raise exception 'Lecture anonyme du catalogue invalide'; end if;
end $$;
reset role;

rollback;
