import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const TOLERANCE_SECONDES = 5 * 60;
const encoder = new TextEncoder();

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((octet) => octet.toString(16).padStart(2, "0")).join("");

const comparaisonConstante = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
};

async function signatureValide(entete: string, corps: string, secret: string) {
  const morceaux = entete.split(",").map((morceau) => morceau.trim());
  const timestamp = morceaux.find((morceau) => morceau.startsWith("t="))?.slice(2) || "";
  const signatures = morceaux.filter((morceau) => morceau.startsWith("v1=")).map((morceau) => morceau.slice(3));
  if (!/^\d{10,13}$/.test(timestamp) || !signatures.length) return false;

  const secondes = Number(timestamp.length === 13 ? Number(timestamp) / 1000 : timestamp);
  if (!Number.isFinite(secondes) || Math.abs(Date.now() / 1000 - secondes) > TOLERANCE_SECONDES) {
    return false;
  }

  const cle = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const attendu = hex(await crypto.subtle.sign("HMAC", cle, encoder.encode(timestamp + corps)));
  return signatures.some((signature) => comparaisonConstante(signature.toLowerCase(), attendu));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Methode non autorisee." }, { status: 405 });

  const jeton = new URL(req.url).searchParams.get("tenant") || "";
  if (!/^[0-9a-f-]{36}$/i.test(jeton)) return Response.json({ error: "Tenant invalide." }, { status: 404 });

  const brut = await req.text();
  const enteteSignature = req.headers.get("wave-signature") || "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: configuration, error: configurationError } = await admin
    .rpc("rpc_lire_configuration_wave_webhook", { p_jeton_webhook: jeton });
  if (configurationError || !configuration?.actif || !configuration?.signing_secret) {
    return Response.json({ error: "Webhook inconnu." }, { status: 404 });
  }
  if (!(await signatureValide(enteteSignature, brut, configuration.signing_secret))) {
    return Response.json({ error: "Signature invalide ou expiree." }, { status: 401 });
  }

  let evenement: Record<string, any>;
  try {
    evenement = JSON.parse(brut);
  } catch {
    return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (evenement?.type !== "checkout.session.completed") {
    return Response.json({ ok: true, ignore: true });
  }
  const session = evenement?.data || {};
  if (session.payment_status !== "succeeded" || session.currency !== "XOF" || !session.id) {
    return Response.json({ ok: true, ignore: true });
  }

  const { data: paiement } = await admin.from("paiements_marketplace")
    .select("id, montant, statut, boutique_id, boutiques(organisation_id)")
    .eq("reference_fournisseur", String(session.id))
    .eq("fournisseur", "WAVE")
    .maybeSingle();
  const boutique = Array.isArray(paiement?.boutiques) ? paiement.boutiques[0] : paiement?.boutiques;
  if (!paiement || boutique?.organisation_id !== configuration.organisation_id) {
    return Response.json({ error: "Paiement inconnu." }, { status: 404 });
  }
  if (Number(session.amount) !== Number(paiement.montant)) {
    return Response.json({ error: "Montant incoherent." }, { status: 409 });
  }

  const { error } = await admin.rpc("rpc_enregistrer_etat_paiement_wave", {
    p_paiement_id: paiement.id,
    p_succes: true,
    p_reference: session.id,
    p_payload: evenement,
  });
  if (error) return Response.json({ error: "Confirmation impossible." }, { status: 500 });
  return Response.json({ ok: true, duplicate: paiement.statut === "CONFIRME" });
});
