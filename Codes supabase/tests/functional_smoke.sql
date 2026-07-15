begin;

do $$
declare
  v_super_admin uuid := '10000000-0000-0000-0000-000000000001';
  v_marchand uuid := '10000000-0000-0000-0000-000000000002';
  v_agent uuid := '10000000-0000-0000-0000-000000000003';
  v_client uuid := '10000000-0000-0000-0000-000000000004';
  v_tenant jsonb;
  v_invitation jsonb;
  v_organisation uuid;
  v_boutique uuid;
  v_produit uuid;
  v_variante uuid;
  v_adresse uuid;
  v_achat uuid;
  v_commande uuid;
  v_stock integer;
  v_total bigint;
  v_historique integer;
begin
  insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at)
  values
    (v_super_admin, 'superadmin-smoke@ikigai.test', '{"prenom":"Super","nom":"Admin"}', now(), now()),
    (v_marchand, 'marchand-smoke@ikigai.test', '{"prenom":"Admin","nom":"Marchand"}', now(), now()),
    (v_agent, 'agent-smoke@ikigai.test', '{"prenom":"Agent","nom":"Commandes"}', now(), now()),
    (v_client, 'client-smoke@ikigai.test', '{"prenom":"Client","nom":"Test"}', now(), now());

  perform set_config('request.jwt.claim.sub', v_super_admin::text, true);
  insert into public.administrateurs_plateforme (identite_id, role, actif)
  values (v_super_admin, 'SUPER_ADMIN', true);

  v_tenant := public.rpc_admin_creer_tenant(
    'Boutique Smoke',
    'boutique-smoke',
    'MARCHAND',
    'marchand-smoke@ikigai.test',
    true
  );
  v_organisation := (v_tenant ->> 'organisation_id')::uuid;
  v_boutique := (v_tenant ->> 'boutique_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_marchand::text, true);
  perform public.rpc_accepter_invitation((v_tenant ->> 'token')::uuid);

  v_invitation := public.rpc_inviter_membre(
    v_organisation,
    'agent-smoke@ikigai.test',
    'AGENT'
  );

  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  perform public.rpc_accepter_invitation((v_invitation ->> 'token')::uuid);

  perform set_config('request.jwt.claim.sub', v_marchand::text, true);
  v_produit := public.rpc_enregistrer_produit_marketplace(
    v_boutique,
    'Produit Smoke',
    5000,
    10,
    null,
    null,
    'Produit de test transactionnel',
    'IKIGAI',
    array['https://example.test/produit.webp'],
    'ACTIF'
  );

  if (select statut from public.boutiques where id = v_boutique) <> 'PUBLIEE' then
    raise exception 'La boutique n''a pas ete publiee avec son premier produit actif.';
  end if;
  select id into v_variante
  from public.variantes_produit
  where produit_id = v_produit
  order by cree_le
  limit 1;

  insert into public.adresses_livraison
    (identite_id, destinataire_nom, telephone, adresse, commune)
  values
    (v_client, 'Client Test', '+2250102030405', 'Rue du test', 'Abidjan')
  returning id into v_adresse;

  -- Premiere commande : annulation client et restitution du stock.
  perform set_config('request.jwt.claim.sub', v_client::text, true);
  perform public.rpc_ajouter_au_panier(v_variante, 2);
  v_achat := public.rpc_valider_panier(v_adresse, 'A_LA_LIVRAISON', 'Commande a annuler');
  select id into v_commande
  from public.commandes_marketplace
  where achat_id = v_achat;

  select quantite into v_stock from public.stocks where variante_id = v_variante;
  if v_stock <> 8 then raise exception 'Decrement du stock invalide : %', v_stock; end if;

  perform public.rpc_annuler_commande_client(v_commande, 'Test annulation');
  select quantite into v_stock from public.stocks where variante_id = v_variante;
  select total into v_total from public.achats where id = v_achat;
  if v_stock <> 10 then raise exception 'Restitution du stock invalide : %', v_stock; end if;
  if v_total <> 0 then raise exception 'Total apres annulation invalide : %', v_total; end if;

  -- Seconde commande : traitement par un salarie jusqu'a livraison.
  perform public.rpc_ajouter_au_panier(v_variante, 1);
  v_achat := public.rpc_valider_panier(v_adresse, 'A_LA_LIVRAISON', 'Commande a livrer');
  select id into v_commande
  from public.commandes_marketplace
  where achat_id = v_achat;

  perform set_config('request.jwt.claim.sub', v_agent::text, true);
  perform public.rpc_changer_statut_commande_marketplace(v_commande, 'CONFIRMEE', null);
  perform public.rpc_changer_statut_commande_marketplace(v_commande, 'EN_PREPARATION', null);
  perform public.rpc_changer_statut_commande_marketplace(v_commande, 'PRETE', null);
  perform public.rpc_changer_statut_commande_marketplace(v_commande, 'EN_LIVRAISON', null);
  perform public.rpc_changer_statut_commande_marketplace(v_commande, 'LIVREE', null);

  if (select statut from public.commandes_marketplace where id = v_commande) <> 'LIVREE' then
    raise exception 'Statut final de commande invalide.';
  end if;
  if (select statut_paiement from public.achats where id = v_achat) <> 'PAYE' then
    raise exception 'Paiement a la livraison non confirme.';
  end if;

  select count(*) into v_historique
  from public.historique_statuts_commande
  where commande_id = v_commande;
  if v_historique <> 6 then
    raise exception 'Historique de statuts incomplet : %', v_historique;
  end if;
end $$;

-- Ces lectures passent reellement par les politiques RLS. Toute recursion
-- entre achats et commandes fait echouer ce bloc avant le rollback.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select count(*) from public.achats;
select count(*) from public.adresses_livraison;
select count(*) from public.commandes_marketplace;
select count(*) from public.lignes_commande_marketplace;
select count(*) from public.historique_statuts_commande;
select count(*) from public.paiements_marketplace;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select count(*) from public.achats;
select count(*) from public.adresses_livraison;
select count(*) from public.commandes_marketplace;
select count(*) from public.lignes_commande_marketplace;
select count(*) from public.historique_statuts_commande;
select count(*) from public.missions_logistiques;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select count(*) from public.achats;
select count(*) from public.adresses_livraison;
select count(*) from public.commandes_marketplace;
select count(*) from public.administrateurs_plateforme;
reset role;

rollback;
