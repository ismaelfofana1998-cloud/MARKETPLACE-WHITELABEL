import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { json, relationUnique } from "../_shared/operations.ts";
import { estimerTarif, obtenirTarifsIkms } from "../_shared/tarifs-ikms.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZONE = /^[\p{L}\p{N}_ -]{1,80}$/u;
const MAX_BOUTIQUES = 20;

const objetUnique = (valeur: unknown) =>
  relationUnique(valeur as Record<string, unknown> | Record<string, unknown>[] | null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Methode non autorisee." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("authorization") || "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Session manquante." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
  if (authError || !authData.user) return json({ error: "Session invalide." }, 401);

  const body = await req.json().catch(() => ({}));
  const zoneArrivee = String(body.zone_arrivee || "").trim().toUpperCase();
  const boutiqueIds = [...new Set(
    (Array.isArray(body.boutique_ids) ? body.boutique_ids : [])
      .map((id: unknown) => String(id || "").trim())
      .filter(Boolean),
  )];
  if (!ZONE.test(zoneArrivee)) return json({ error: "Zone de livraison invalide." }, 400);
  if (!boutiqueIds.length || boutiqueIds.length > MAX_BOUTIQUES || boutiqueIds.some((id) => !UUID.test(id))) {
    return json({ error: "Liste de boutiques invalide." }, 400);
  }

  const { data: lignes, error: lignesError } = await userClient
    .from("lignes_panier")
    .select("paniers!inner(identite_id, statut), variantes_produit!inner(produits!inner(boutique_id))")
    .eq("paniers.identite_id", authData.user.id)
    .eq("paniers.statut", "ACTIF");
  if (lignesError) return json({ error: "Panier inaccessible." }, 500);

  const boutiquesDuPanier = new Set<string>();
  for (const ligne of lignes || []) {
    const variante = objetUnique(ligne.variantes_produit);
    const produit = objetUnique(variante?.produits);
    const boutiqueId = String(produit?.boutique_id || "");
    if (boutiqueId) boutiquesDuPanier.add(boutiqueId);
  }
  if (boutiqueIds.some((id) => !boutiquesDuPanier.has(id))) {
    return json({ error: "Une boutique ne fait pas partie du panier actif." }, 403);
  }

  const estimations = await Promise.all(boutiqueIds.map(async (boutiqueId) => {
    const { data: integration, error: integrationError } = await admin
      .rpc("rpc_lire_integration_ikms_boutique", { p_boutique_id: boutiqueId });
    if (
      integrationError || !integration?.actif || !integration?.api_key ||
      !integration?.api_base_url || !integration?.zone_depart
    ) {
      return { boutique_id: boutiqueId, montant: null };
    }

    const tarifs = await obtenirTarifsIkms({
      boutiqueId,
      apiBaseUrl: integration.api_base_url,
      apiKey: integration.api_key,
    });
    return {
      boutique_id: boutiqueId,
      montant: estimerTarif(tarifs, integration.zone_depart, zoneArrivee),
    };
  }));

  const complete = estimations.every((estimation) => estimation.montant !== null);
  const montantTotal = complete
    ? estimations.reduce((total, estimation) => total + Number(estimation.montant), 0)
    : null;

  return json({
    data: {
      zone_arrivee: zoneArrivee,
      estimations,
      complete,
      montant_total: montantTotal,
    },
  });
});
