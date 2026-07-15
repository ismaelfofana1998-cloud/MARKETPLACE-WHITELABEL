-- IKIGAI Market - durcissement apres audit Supabase.

set search_path = public, extensions;

-- Un bucket public sert les URLs sans politique SELECT. Retirer cette politique
-- empeche l'enumeration de tous les fichiers via l'API Storage.
drop policy if exists marketplace_medias_lecture on storage.objects;

-- Fonction d'event trigger interne : elle ne doit jamais etre exposee comme RPC.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Ancienne API remplacee par rpc_enregistrer_produit_marketplace.
drop function if exists public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text);

create index if not exists avis_produits_identite_idx
  on public.avis_produits(identite_id);

create index if not exists commandes_annulee_par_idx
  on public.commandes_marketplace(annulee_par);

create index if not exists historique_change_par_idx
  on public.historique_statuts_commande(change_par);
