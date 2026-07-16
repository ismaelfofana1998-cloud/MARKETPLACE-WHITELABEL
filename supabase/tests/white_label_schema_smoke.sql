do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'offres_organisations', 'configurations_boutique', 'categories_boutique',
    'domaines_boutique', 'integrations_ikms_boutique'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'RLS absente sur public.%', v_table;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'boutiques'
      and column_name = 'mode_vitrine'
  ) then raise exception 'Mode WHITE_LABEL absent des boutiques'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'paniers'
      and column_name = 'boutique_contexte_id'
  ) then raise exception 'Contexte de panier absent'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'paniers_actif_vitrine_idx'
  ) then raise exception 'Index d''isolation des paniers absent'; end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_resoudre_vitrine'
  ) then raise exception 'Resolution de Site dedie absente'; end if;

  if not has_function_privilege(
    'anon', 'public.rpc_resoudre_vitrine(text,text)', 'EXECUTE'
  ) then raise exception 'Resolution publique du Site dedie non exposee'; end if;

  if has_function_privilege(
    'anon', 'public.rpc_lire_integration_ikms_boutique(uuid)', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'public.rpc_lire_integration_ikms_boutique(uuid)', 'EXECUTE'
  ) then raise exception 'Secret IKMS d''etablissement expose'; end if;

  if has_function_privilege(
    'anon', 'private.valider_ligne_panier_contexte()', 'EXECUTE'
  ) or has_function_privilege(
    'authenticated', 'private.valider_ligne_panier_contexte()', 'EXECUTE'
  ) then raise exception 'Validateur prive de panier expose'; end if;

  if has_table_privilege('authenticated', 'public.paniers', 'INSERT')
     or has_table_privilege('authenticated', 'public.paniers', 'UPDATE')
     or has_table_privilege('authenticated', 'public.lignes_panier', 'INSERT')
     or has_table_privilege('authenticated', 'public.lignes_panier', 'UPDATE') then
    raise exception 'Ecriture directe du panier encore exposee';
  end if;

  if has_table_privilege('authenticated', 'public.domaines_boutique', 'INSERT')
     or has_table_privilege('authenticated', 'public.domaines_boutique', 'UPDATE') then
    raise exception 'Ecriture directe des domaines encore exposee';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.rpc_ajouter_domaine_boutique(uuid,text)', 'EXECUTE'
  ) or not has_function_privilege(
    'authenticated', 'public.rpc_enregistrer_produit_vitrine(uuid,text,bigint,integer,uuid,uuid,uuid,text,text,text[],text)', 'EXECUTE'
  ) then raise exception 'RPC de gestion du Site dedie non exposees'; end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'configurations_boutique'
      and policyname = 'configurations_boutique_publiques'
  ) then raise exception 'Politique publique de theme absente'; end if;
end $$;
