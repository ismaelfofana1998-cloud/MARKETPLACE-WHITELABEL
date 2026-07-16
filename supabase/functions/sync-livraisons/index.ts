import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import {
  json,
  relationUnique,
  traiterNotificationsEmail,
  urlIkms,
} from "../_shared/operations.ts";

const statutsActifs = ["ENVOYEE", "ACCEPTEE", "EN_COURS", "RETOUR"];

function statutColis(colis: Array<Record<string, unknown>>) {
  const statuts = colis.map((element) => String(element.statut || "CREE").toUpperCase());
  if (statuts.length && statuts.every((statut) => statut === "LIVRE")) return "LIVRE";
  if (statuts.includes("ANNULE")) return "ANNULE";
  const retours = ["RETOURNE", "RETOUR_ASSIGNE", "A_RETOURNER", "RETOUR_RECU", "RETOUR_DEMANDE", "RETOUR_EN_COURS"];
  return retours.find((statut) => statuts.includes(statut)) || statuts[0] || "CREE";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "Methode non autorisee." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const body = await req.json().catch(() => ({}));

  const cronSecret = req.headers.get("x-ikigai-cron-secret") || "";
  const { data: secretValide } = cronSecret
    ? await admin.rpc("rpc_verifier_secret_operations", { p_secret: cronSecret })
    : { data: false };

  const authorization = req.headers.get("authorization") || "";
  let userClient: ReturnType<typeof createClient> | null = null;
  let utilisateurId: string | null = null;
  if (!secretValide) {
    const jwt = authorization.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Authentification requise." }, 401);
    userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "Session invalide." }, 401);
    utilisateurId = authData.user.id;
  }

  const commandeId = body.commande_id ? String(body.commande_id) : null;
  const achatId = body.achat_id ? String(body.achat_id) : null;
  const notificationsUniquement = body.notifications_uniquement === true;
  const commandesAutorisees = new Set<string>();
  let missionIds: string[] = [];

  if (secretValide) {
    let requete = admin.from("missions_logistiques").select("id, commande_id")
      .in("statut", statutsActifs).not("commande_livraison_externe_id", "is", null)
      .order("derniere_synchronisation", { ascending: true, nullsFirst: true }).limit(50);
    if (commandeId) requete = requete.eq("commande_id", commandeId);
    const { data } = await requete;
    missionIds = (data || []).map((mission) => mission.id);
    (data || []).forEach((mission) => commandesAutorisees.add(mission.commande_id));
  } else if (userClient) {
    if (commandeId) {
      const { data: commandeVisible } = await userClient.from("commandes_marketplace")
        .select("id").eq("id", commandeId).maybeSingle();
      if (!commandeVisible) return json({ error: "Commande inaccessible." }, 403);
      commandesAutorisees.add(commandeId);
    }
    if (achatId) {
      const { data: commandesAchat } = await userClient.from("commandes_marketplace")
        .select("id").eq("achat_id", achatId);
      (commandesAchat || []).forEach((commande) => commandesAutorisees.add(commande.id));
    }

    let requete = userClient.from("missions_logistiques").select("id, commande_id")
      .in("statut", statutsActifs).not("commande_livraison_externe_id", "is", null).limit(30);
    if (commandeId) requete = requete.eq("commande_id", commandeId);
    const { data: missionsVisibles } = await requete;
    missionIds = (missionsVisibles || []).map((mission) => mission.id);
    (missionsVisibles || []).forEach((mission) => commandesAutorisees.add(mission.commande_id));
  }

  let synchronisees = 0;
  let erreurs = 0;
  if (!notificationsUniquement && missionIds.length) {
    const { data: missions } = await admin.from("missions_logistiques")
      .select("id, commande_id, commande_livraison_externe_id, commandes_marketplace(boutiques(organisation_id))")
      .in("id", missionIds);
    const integrations = new Map<string, Record<string, unknown>>();

    for (const mission of missions || []) {
      const commande = relationUnique(mission.commandes_marketplace) as Record<string, unknown> | null;
      const boutique = relationUnique(commande?.boutiques as Record<string, unknown> | null) as Record<string, unknown> | null;
      const organisationId = String(boutique?.organisation_id || "");
      try {
        let integration = integrations.get(organisationId);
        if (!integration) {
          const { data, error } = await admin.rpc("rpc_lire_integration_ikms", {
            p_organisation_id: organisationId,
          });
          if (error || !data?.actif || !data?.api_key || !data?.api_base_url) {
            throw new Error(error?.message || "Integration IKMS incomplete.");
          }
          integration = data;
          integrations.set(organisationId, integration);
        }

        const response = await fetch(urlIkms(
          integration.api_base_url,
          `commandes/${encodeURIComponent(mission.commande_livraison_externe_id)}`,
        ), {
          headers: { authorization: `Bearer ${integration.api_key}` },
          signal: AbortSignal.timeout(15000),
        });
        const resultat = await response.json().catch(() => ({}));
        if (!response.ok || !resultat.data) {
          throw new Error(resultat.error || `IKMS HTTP ${response.status}`);
        }
        const colis = Array.isArray(resultat.data.colis) ? resultat.data.colis : [];
        const { error: statutError } = await admin.rpc("rpc_appliquer_statut_ikms", {
          p_mission_id: mission.id,
          p_statut_ikms: statutColis(colis),
          p_reponse: resultat,
        });
        if (statutError) throw statutError;
        synchronisees += 1;
      } catch (error) {
        await admin.from("missions_logistiques").update({
          derniere_synchronisation: new Date().toISOString(),
          derniere_erreur: error instanceof Error ? error.message.slice(0, 2000) : "Erreur de synchronisation IKMS",
        }).eq("id", mission.id);
        erreurs += 1;
      }
    }
  }

  let emails = { envoyees: 0, erreurs: 0, configuration_manquante: false };
  if (secretValide) {
    emails = await traiterNotificationsEmail(admin, null, 50);
  } else {
    for (const id of commandesAutorisees) {
      const resultat = await traiterNotificationsEmail(admin, id, 10);
      emails.envoyees += resultat.envoyees;
      emails.erreurs += resultat.erreurs;
      emails.configuration_manquante ||= resultat.configuration_manquante;
    }
  }

  return json({
    data: {
      synchronisees,
      erreurs,
      emails,
      execution: secretValide ? "AUTOMATIQUE" : "UTILISATEUR",
      utilisateur_id: utilisateurId,
    },
  });
});
