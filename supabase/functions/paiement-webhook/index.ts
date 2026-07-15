import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const comparaisonConstante = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Methode non autorisee." }, { status: 405 });
  const secret = Deno.env.get("PAIEMENT_WEBHOOK_SECRET");
  const signature = req.headers.get("x-ikigai-signature") || "";
  const brut = await req.text();
  if (!secret) return Response.json({ error: "Secret absent." }, { status: 500 });

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const attendu = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(brut)));
  if (!comparaisonConstante(signature, attendu)) return Response.json({ error: "Signature invalide." }, { status: 401 });

  const event = JSON.parse(brut);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: paiement } = await admin.from("paiements_marketplace")
    .select("id, achat_id, statut").eq("cle_idempotence", String(event.cle_idempotence || "")).maybeSingle();
  if (!paiement) return Response.json({ error: "Paiement inconnu." }, { status: 404 });
  if (paiement.statut === "CONFIRME") return Response.json({ ok: true, duplicate: true });

  const confirme = event.statut === "CONFIRME";
  await admin.from("paiements_marketplace").update({
    statut: confirme ? "CONFIRME" : "ECHOUE",
    reference_fournisseur: event.reference || null,
    payload: event,
    confirme_le: confirme ? new Date().toISOString() : null,
  }).eq("id", paiement.id);
  await admin.from("achats").update({ statut_paiement: confirme ? "PAYE" : "ECHOUE" }).eq("id", paiement.achat_id);
  return Response.json({ ok: true });
});
