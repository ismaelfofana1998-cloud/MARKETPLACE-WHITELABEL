import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Methode non autorisee." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const livraisonUrl = Deno.env.get("IKIGAI_LIVRAISON_API_URL");
  const livraisonKey = Deno.env.get("IKIGAI_LIVRAISON_API_KEY");
  const authorization = req.headers.get("authorization") || "";
  const jwt = authorization.replace(/^Bearer\s+/i, "");
  if (!jwt || !livraisonUrl || !livraisonKey) return json({ error: "Configuration ou session manquante." }, 401);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceKey);
  const { data: authData } = await userClient.auth.getUser(jwt);
  if (!authData.user) return json({ error: "Session invalide." }, 401);

  const body = await req.json().catch(() => ({}));
  const commandeId = String(body.commande_id || "");
  const { data: commande } = await admin.from("commandes_marketplace")
    .select("id, reference, statut, boutique_id, achat_id, boutiques(organisation_id, nom), achats(adresse_livraison_id, adresses_livraison(destinataire_nom, telephone, adresse, commune, indications)), lignes_commande_marketplace(nom_produit, nom_variante, quantite)")
    .eq("id", commandeId).maybeSingle();
  if (!commande || commande.statut !== "PRETE") return json({ error: "Commande absente ou non prete." }, 409);

  const organisationId = commande.boutiques?.organisation_id;
  const { data: membre } = await admin.from("membres_organisation")
    .select("role, statut").eq("organisation_id", organisationId)
    .eq("identite_id", authData.user.id).maybeSingle();
  if (!membre || membre.statut !== "ACTIF" || !["PROPRIETAIRE", "ADMIN", "GESTIONNAIRE"].includes(membre.role)) {
    return json({ error: "Droit marchand requis." }, 403);
  }

  const { data: integration } = await admin.from("integrations_livraison")
    .select("code_entreprise_livraison, compte_pro_externe_id, actif")
    .eq("organisation_id", organisationId).maybeSingle();
  if (!integration?.actif) return json({ error: "Integration Livraison inactive." }, 409);

  const adresse = commande.achats?.adresses_livraison;
  const payload = {
    source: "IKIGAI_MARKETPLACE",
    reference_externe: commande.reference,
    code_entreprise: integration.code_entreprise_livraison,
    id_compte_pro: integration.compte_pro_externe_id,
    expediteur: { nom: commande.boutiques?.nom },
    destinataire: adresse,
    articles: commande.lignes_commande_marketplace,
  };

  const { data: mission, error: missionError } = await admin.from("missions_logistiques").upsert({
    commande_id: commande.id,
    entreprise_livraison_code: integration.code_entreprise_livraison,
    compte_pro_externe_id: integration.compte_pro_externe_id,
    payload,
    statut: "A_ENVOYER",
  }, { onConflict: "commande_id" }).select("id, tentatives").single();
  if (missionError || !mission) return json({ error: missionError?.message || "Mission non creee." }, 500);

  const response = await fetch(livraisonUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${livraisonKey}`, "idempotency-key": commande.id },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));

  await admin.from("missions_logistiques").update({
    statut: response.ok ? "ENVOYEE" : "ERREUR",
    commande_livraison_externe_id: response.ok ? result.id_commande : null,
    tentatives: Number(mission?.tentatives || 0) + 1,
    derniere_erreur: response.ok ? null : (result.error || `HTTP ${response.status}`),
  }).eq("id", mission.id);

  if (!response.ok) return json({ error: result.error || "Livraison non creee." }, 502);
  await admin.from("commandes_marketplace").update({ statut: "EN_LIVRAISON" }).eq("id", commande.id);
  return json({ data: { mission_id: mission.id, commande_livraison_id: result.id_commande } });
});
