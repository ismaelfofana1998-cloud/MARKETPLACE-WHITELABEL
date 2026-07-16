const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ikigai-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

export const relationUnique = <T>(value: T | T[] | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] || null) : (value || null);

export function telephoneIvoirien(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("225")) digits = digits.slice(3);
  if (!/^\d{10}$/.test(digits)) {
    throw new Error("Le numero de telephone doit contenir 10 chiffres ivoiriens.");
  }
  return digits;
}

export function urlIkms(apiBaseUrl: unknown, chemin: string) {
  const url = new URL(String(apiBaseUrl || ""));
  if (url.protocol !== "https:") throw new Error("L'URL IKMS doit utiliser HTTPS.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${chemin.replace(/^\/+/, "")}`;
  return url.href;
}

function emailHtml(notification: Record<string, unknown>, configuration: Record<string, unknown>) {
  const base = String(configuration.site_public_url || "").replace(/\/+$/, "");
  const lien = `${base}/marketplace/compte.html#commandes`;
  const couleur = /^#[0-9a-f]{6}$/i.test(String(configuration.couleur_primaire || ""))
    ? String(configuration.couleur_primaire)
    : "#c75332";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f3;font-family:Arial,sans-serif;color:#17211f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e6e6e2"><tr><td style="padding:24px;background:${couleur};color:#fff"><strong style="font-size:20px">${escapeHtml(configuration.nom_marketplace || "IKIGAI Market")}</strong></td></tr><tr><td style="padding:28px"><p style="margin:0 0 8px;color:#68706d;font-size:14px">Bonjour ${escapeHtml(notification.destinataire_nom || "")},</p><h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">${escapeHtml(notification.sujet)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 20px">${escapeHtml(notification.message)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;border:1px solid #e8e8e4;margin:0 0 24px"><tr><td style="padding:16px"><strong>${escapeHtml(notification.commande_reference)}</strong><br><span style="color:#68706d;font-size:14px">${escapeHtml(notification.boutique_nom)}</span></td></tr></table><a href="${escapeHtml(lien)}" style="display:inline-block;background:${couleur};color:#fff;text-decoration:none;padding:12px 18px;font-weight:bold">Suivre ma commande</a></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #ecece8;color:#777;font-size:12px">Message automatique, conserve dans l'historique de votre commande.</td></tr></table></td></tr></table></body></html>`;
}

// deno-lint-ignore no-explicit-any
export async function traiterNotificationsEmail(admin: any, commandeId: string | null = null, limite = 30) {
  const { data: configuration, error: configurationError } = await admin
    .rpc("rpc_lire_configuration_email");
  if (configurationError) throw configurationError;
  if (!configuration?.actif || !configuration?.api_key || !configuration?.email_expediteur) {
    return { envoyees: 0, erreurs: 0, configuration_manquante: true };
  }

  const { data: notifications, error: claimError } = await admin
    .rpc("rpc_reclamer_notifications_email", {
      p_commande_id: commandeId,
      p_limite: limite,
    });
  if (claimError) throw claimError;

  let envoyees = 0;
  let erreurs = 0;
  for (const notification of notifications || []) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${configuration.api_key}`,
        },
        body: JSON.stringify({
          from: `${configuration.nom_expediteur} <${configuration.email_expediteur}>`,
          to: [notification.destinataire_email],
          subject: notification.sujet,
          html: emailHtml(notification, configuration),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const resultat = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(resultat.message || resultat.error || `Email HTTP ${response.status}`);

      await admin.from("notifications_email_commande").update({
        statut: "ENVOYEE",
        reference_fournisseur: resultat.id || null,
        derniere_erreur: null,
        envoyee_le: new Date().toISOString(),
      }).eq("id", notification.id);
      envoyees += 1;
    } catch (error) {
      const minutes = Math.min(60, Math.max(2, 2 ** Number(notification.tentatives || 1)));
      await admin.from("notifications_email_commande").update({
        statut: "ERREUR",
        derniere_erreur: error instanceof Error ? error.message.slice(0, 2000) : "Erreur email",
        prochaine_tentative: new Date(Date.now() + minutes * 60000).toISOString(),
      }).eq("id", notification.id);
      erreurs += 1;
    }
  }
  return { envoyees, erreurs, configuration_manquante: false };
}
