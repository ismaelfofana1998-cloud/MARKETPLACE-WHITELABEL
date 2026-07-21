import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { json, relationUnique } from "../_shared/operations.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_WAVE = "https://api.wave.com/v1/checkout/sessions";

const objetUnique = (valeur: unknown) =>
  relationUnique(valeur as Record<string, unknown> | Record<string, unknown>[] | null);

const donneesSessionSures = (session: Record<string, unknown>) => ({
  id: session.id || null,
  checkout_status: session.checkout_status || null,
  payment_status: session.payment_status || null,
  transaction_id: session.transaction_id || null,
  wave_launch_url: session.wave_launch_url || null,
  business_name: session.business_name || null,
  when_expires: session.when_expires || null,
});

async function appelerWave(apiKey: string, url: string, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  const resultat = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(resultat?.message || resultat?.error || `Wave HTTP ${response.status}`));
  }
  return resultat as Record<string, unknown>;
}

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
  const achatId = String(body.achat_id || "").trim();
  if (!UUID.test(achatId)) return json({ error: "Achat invalide." }, 400);

  const { data: achat, error: achatError } = await admin.from("achats")
    .select("id, acheteur_id, reference, mode_paiement, statut_paiement")
    .eq("id", achatId)
    .eq("acheteur_id", authData.user.id)
    .maybeSingle();
  if (achatError || !achat) return json({ error: "Achat introuvable." }, 404);
  if (achat.mode_paiement !== "WAVE") return json({ error: "Cet achat n'utilise pas Wave." }, 409);

  const [{ data: paiements, error: paiementsError }, { data: configuration }] = await Promise.all([
    admin.from("paiements_marketplace")
      .select("id, achat_id, commande_id, boutique_id, montant, statut, reference_fournisseur, payload, boutiques(nom)")
      .eq("achat_id", achatId)
      .eq("fournisseur", "WAVE")
      .order("cree_le"),
    admin.from("configuration_marketplace").select("site_public_url").eq("id", 1).single(),
  ]);
  if (paiementsError || !paiements?.length) {
    return json({ error: "Paiements Wave introuvables." }, 404);
  }

  const base = new URL(String(configuration?.site_public_url || "https://ismaelfofana1998-cloud.github.io/MARKETPLACE-WHITELABEL/"));
  if (base.protocol !== "https:") return json({ error: "URL publique HTTPS invalide." }, 500);
  const retour = new URL("marketplace/paiement.html", base);
  retour.searchParams.set("achat", achatId);
  const succesUrl = new URL(retour);
  succesUrl.searchParams.set("wave", "succes");
  const erreurUrl = new URL(retour);
  erreurUrl.searchParams.set("wave", "erreur");

  const resultats = [];
  for (const paiement of paiements) {
    const boutique = objetUnique(paiement.boutiques);
    const resultatBase = {
      paiement_id: paiement.id,
      boutique_id: paiement.boutique_id,
      boutique_nom: String(boutique?.nom || "Boutique"),
      montant: Number(paiement.montant),
    };
    if (paiement.statut === "CONFIRME") {
      resultats.push({ ...resultatBase, statut: "CONFIRME", wave_launch_url: null });
      continue;
    }

    const { data: wave, error: waveError } = await admin
      .rpc("rpc_lire_configuration_wave_boutique", { p_boutique_id: paiement.boutique_id });
    if (waveError || !wave?.actif || !wave?.api_key) {
      resultats.push({
        ...resultatBase,
        statut: "INDISPONIBLE",
        erreur: "Wave n'est pas configure pour cette boutique.",
      });
      continue;
    }

    try {
      let session: Record<string, unknown> | null = null;
      if (paiement.reference_fournisseur) {
        try {
          session = await appelerWave(
            wave.api_key,
            `${API_WAVE}/${encodeURIComponent(paiement.reference_fournisseur)}`,
          );
        } catch {
          session = null;
        }
      }

      if (session?.payment_status === "succeeded") {
        await admin.rpc("rpc_enregistrer_etat_paiement_wave", {
          p_paiement_id: paiement.id,
          p_succes: true,
          p_reference: session.id,
          p_payload: donneesSessionSures(session),
        });
        resultats.push({ ...resultatBase, statut: "CONFIRME", wave_launch_url: null });
        continue;
      }

      if (session?.checkout_status !== "open" || !session?.wave_launch_url) {
        session = await appelerWave(wave.api_key, API_WAVE, {
          method: "POST",
          body: JSON.stringify({
            amount: String(paiement.montant),
            currency: "XOF",
            client_reference: paiement.id,
            success_url: succesUrl.href,
            error_url: erreurUrl.href,
          }),
        });
        await admin.from("paiements_marketplace").update({
          statut: "INITIE",
          reference_fournisseur: session.id,
          payload: donneesSessionSures(session),
          confirme_le: null,
        }).eq("id", paiement.id);
      }

      resultats.push({
        ...resultatBase,
        statut: "A_PAYER",
        wave_launch_url: session.wave_launch_url,
        expire_le: session.when_expires || null,
      });
    } catch (error) {
      resultats.push({
        ...resultatBase,
        statut: "ERREUR",
        erreur: error instanceof Error ? error.message.slice(0, 300) : "Wave indisponible.",
      });
    }
  }

  const complet = resultats.every((paiement) => paiement.statut === "CONFIRME");
  return json({ data: { achat_id: achatId, reference: achat.reference, complet, paiements: resultats } });
});
