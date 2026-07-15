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
  const authorization = req.headers.get("authorization") || "";
  const tokenJwt = authorization.replace(/^Bearer\s+/i, "");
  if (!tokenJwt) return json({ error: "Authentification requise." }, 401);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser(tokenJwt);
  if (authError || !authData.user) return json({ error: "Session invalide." }, 401);

  const body = await req.json().catch(() => ({}));
  const organisationId = String(body.organisation_id || "");
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "MEMBRE").toUpperCase();
  if (!organisationId || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Organisation et email requis." }, 400);
  if (!["ADMIN", "GESTIONNAIRE", "AGENT", "MEMBRE"].includes(role)) return json({ error: "Role invalide." }, 400);

  const { data: membre } = await admin.from("membres_organisation")
    .select("role, statut").eq("organisation_id", organisationId)
    .eq("identite_id", authData.user.id).maybeSingle();
  if (!membre || membre.statut !== "ACTIF" || !["PROPRIETAIRE", "ADMIN"].includes(membre.role)) {
    return json({ error: "Droit administrateur requis." }, 403);
  }

  const invitationToken = crypto.randomUUID();
  const { data: invitation, error: insertError } = await admin.from("invitations_organisation").insert({
    organisation_id: organisationId,
    email,
    role,
    token: invitationToken,
    invite_par: authData.user.id,
  }).select("id, token, expire_le").single();
  if (insertError) return json({ error: insertError.message }, 400);

  const appUrl = Deno.env.get("IDENTITY_APP_URL") || "http://127.0.0.1:8080/identity/";
  const redirectTo = `${appUrl}?invitation=${invitationToken}`;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  return json({
    data: {
      ...invitation,
      lien: redirectTo,
      email_envoye: !inviteError,
      avertissement: inviteError?.message || null,
    },
  });
});
