do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'identites', 'organisations', 'membres_organisation', 'invitations_organisation', 'administrateurs_plateforme',
    'categories_marketplace', 'boutiques', 'produits', 'variantes_produit', 'stocks', 'adresses_livraison',
    'paniers', 'lignes_panier', 'achats', 'commandes_marketplace',
    'lignes_commande_marketplace', 'paiements_marketplace', 'avis_produits',
    'integrations_livraison', 'missions_logistiques', 'configuration_marketplace',
    'favoris_marketplace', 'historique_statuts_commande'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'RLS absente sur public.%', v_table;
    end if;
  end loop;

  if not exists (select 1 from pg_proc where proname = 'rpc_valider_panier') then
    raise exception 'rpc_valider_panier absente';
  end if;
  if not exists (select 1 from pg_proc where proname = 'rpc_creer_organisation') then
    raise exception 'rpc_creer_organisation absente';
  end if;
  if not exists (select 1 from pg_proc where proname = 'rpc_enregistrer_produit_marketplace') then
    raise exception 'rpc_enregistrer_produit_marketplace absente';
  end if;
  if not exists (select 1 from pg_proc where proname = 'rpc_admin_creer_tenant') then
    raise exception 'rpc_admin_creer_tenant absente';
  end if;
  if not exists (select 1 from public.configuration_marketplace where id = 1) then
    raise exception 'configuration_marketplace non initialisee';
  end if;
end $$;
