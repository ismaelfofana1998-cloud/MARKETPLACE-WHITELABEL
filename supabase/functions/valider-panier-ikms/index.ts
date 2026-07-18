import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { json, relationUnique } from "../_shared/operations.ts";
import { estimerTarif, obtenirTarifsIkms } from "../_shared/tarifs-ikms.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES_PAIEMENT = new Set(["A_LA_LIVRAISON"]);

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
  const adresseId = String(body.adresse_id || "").trim();
  const modePaiement = String(body.mode_paiement || "").trim().toUpperCase();
  const boutiqueContexteId = body.boutique_contexte_id
    ? String(body.boutique_contexte_id).trim()
    : null;
  const note = body.note ? String(body.note).trim().slice(0, 2000) : null;

  if (!UUID.test(adresseId)) return json({ error: "Adresse invalide." }, 400);
  if (boutiqueContexteId && !UUID.test(boutiqueContexteId)) {
    return json({ error: "Contexte boutique invalide." }, 400);
  }
  // Wave sera active par tenant dans un flux separe. Tant que ce flux n'est
  // pas complet, le checkout ne doit pas creer un paiement global par erreur.
  if (!MODES_PAIEMENT.has(modePaiement)) {
    return json({ error: "Mode de paiement momentanement indisponible." }, 400);
  }

  const { data: adresse, error: adresseError } = await userClient
    .from("adresses_livraison")
    .select("id, code_zone")
    .eq("id", adresseId)
    .eq("identite_id", authData.user.id)
    .maybeSingle();
  if (adresseError || !adresse?.code_zone) {
    return json({ error: "Adresse ou zone de livraison invalide." }, 400);
  }

  let lignesRequete = userClient
    .from("lignes_panier")
    .select("paniers!inner(identite_id, statut, boutique_contexte_id), variantes_produit!inner(produits!inner(boutique_id))")
    .eq("paniers.identite_id", authData.user.id)
    .eq("paniers.statut", "ACTIF");
  lignesRequete = boutiqueContexteId
    ? lignesRequete.eq("paniers.boutique_contexte_id", boutiqueContexteId)
    : lignesRequete.is("paniers.boutique_contexte_id", null);
  const { data: lignes, error: lignesError } = await lignesRequete;
  if (lignesError) return json({ error: "Panier inaccessible." }, 500);

  const boutiqueIds = [...new Set((lignes || []).map((ligne) => {
    const variante = objetUnique(ligne.variantes_produit);
    const produit = objetUnique(variante?.produits);
    return String(produit?.boutique_id || "");
  }).filter(Boolean))];
  if (!boutiqueIds.length) return json({ error: "Le panier est vide." }, 400);

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
      montant: estimerTarif(tarifs, integration.zone_depart, adresse.code_zone),
    };
  }));

  const fraisParBoutique = Object.fromEntries(
    estimations.map(({ boutique_id, montant }) => [boutique_id, montant]),
  );
  const { data: achatId, error: validationError } = await admin
    .rpc("rpc_valider_panier_tarife", {
      p_acheteur_id: authData.user.id,
      p_adresse_id: adresseId,
      p_mode_paiement: modePaiement,
      p_note: note,
      p_boutique_contexte_id: boutiqueContexteId,
      p_frais_par_boutique: fraisParBoutique,
    });
  if (validationError) return json({ error: validationError.message }, 400);

  return json({
    data: {
      achat_id: achatId,
      estimation_complete: estimations.every(({ montant }) => montant !== null),
      estimations,
    },
  });
});
