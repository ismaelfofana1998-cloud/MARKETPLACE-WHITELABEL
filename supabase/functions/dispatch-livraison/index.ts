import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import {
  corsHeaders,
  json,
  relationUnique,
  telephoneIvoirien,
  traiterNotificationsEmail,
  urlIkms,
} from "../_shared/operations.ts";

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
  const commandeId = String(body.commande_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(commandeId)) return json({ error: "Commande invalide." }, 400);

  const { data: commande, error: commandeError } = await admin
    .from("commandes_marketplace")
    .select("id, reference, statut, boutique_id, boutiques(organisation_id, nom), achats(adresses_livraison(destinataire_nom, telephone, adresse, commune, indications, code_zone)), lignes_commande_marketplace(nom_produit, nom_variante, quantite)")
    .eq("id", commandeId)
    .maybeSingle();
  if (commandeError) return json({ error: commandeError.message }, 500);
  if (!commande || commande.statut !== "PRETE") {
    return json({ error: "Commande absente ou non prete." }, 409);
  }

  const boutique = relationUnique(commande.boutiques) as Record<string, unknown> | null;
  const organisationId = String(boutique?.organisation_id || "");
  const { data: membre } = await admin
    .from("membres_organisation")
    .select("role, statut")
    .eq("organisation_id", organisationId)
    .eq("identite_id", authData.user.id)
    .maybeSingle();
  if (!membre || membre.statut !== "ACTIF" || !["PROPRIETAIRE", "ADMIN", "GESTIONNAIRE", "AGENT"].includes(membre.role)) {
    return json({ error: "Droit operateur marchand requis." }, 403);
  }

  const { data: integration, error: integrationError } = await admin
    .rpc("rpc_lire_integration_ikms_boutique", { p_boutique_id: commande.boutique_id });
  if (integrationError) return json({ error: integrationError.message }, 500);
  if (!integration?.actif || !integration?.api_key || !integration?.api_base_url) {
    return json({ error: "Connexion IKMS inactive ou incomplete." }, 409);
  }

  try {
    const achat = relationUnique(commande.achats) as Record<string, unknown> | null;
    const adresse = relationUnique(achat?.adresses_livraison as Record<string, unknown> | null) as Record<string, unknown> | null;
    if (!adresse?.code_zone) throw new Error("La zone IKMS de l'adresse client est manquante.");

    const destinataireAdresse = [adresse.adresse, adresse.commune, adresse.indications]
      .filter(Boolean).join(", ");
    const payload = {
      expediteur_nom: integration.expediteur_nom || boutique?.nom,
      expediteur_tel: telephoneIvoirien(integration.expediteur_tel),
      expediteur_adresse: integration.expediteur_adresse || null,
      mode_paiement: integration.mode_paiement || "SANS_PAIEMENT",
      zone_depart: integration.zone_depart,
      colis: [{
        destinataire_nom: adresse.destinataire_nom,
        destinataire_tel: telephoneIvoirien(adresse.telephone),
        destinataire_adresse: destinataireAdresse,
        code_zone: String(adresse.code_zone).toUpperCase(),
      }],
    };

    const { data: reclamation, error: reclamationError } = await admin
      .rpc("rpc_reclamer_mission_ikms", { p_commande_id: commande.id, p_payload: payload });
    if (reclamationError) return json({ error: reclamationError.message }, 409);
    if (!reclamation?.envoyer) {
      await traiterNotificationsEmail(admin, commande.id, 10);
      return json({ data: reclamation });
    }

    let response: Response;
    let resultat: Record<string, unknown> = {};
    try {
      response = await fetch(urlIkms(integration.api_base_url, "commandes"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${integration.api_key}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      resultat = await response.json().catch(() => ({}));
    } catch (error) {
      await admin.rpc("rpc_finaliser_mission_ikms", {
        p_mission_id: reclamation.mission_id,
        p_acteur_id: authData.user.id,
        p_succes: false,
        p_reponse: {},
        p_erreur: error instanceof Error ? error.message : "IKMS injoignable",
      });
      return json({ error: "IKMS est momentanement injoignable." }, 502);
    }

    const data = (resultat.data || {}) as Record<string, unknown>;
    const colis = Array.isArray(data.colis) ? data.colis[0] as Record<string, unknown> : null;
    if (!response.ok || !data.id_commande || !colis) {
      const erreur = String(resultat.error || `IKMS HTTP ${response.status}`);
      await admin.rpc("rpc_finaliser_mission_ikms", {
        p_mission_id: reclamation.mission_id,
        p_acteur_id: authData.user.id,
        p_succes: false,
        p_reponse: resultat,
        p_erreur: erreur,
      });
      return json({ error: erreur }, 502);
    }

    const { data: finalisation, error: finalisationError } = await admin
      .rpc("rpc_finaliser_mission_ikms", {
        p_mission_id: reclamation.mission_id,
        p_acteur_id: authData.user.id,
        p_succes: true,
        p_commande_externe_id: String(data.id_commande),
        p_code_ramassage: data.code_ramassage ? String(data.code_ramassage) : null,
        p_id_colis: colis.id_colis ? String(colis.id_colis) : null,
        p_code_livraison: colis.code_livraison ? String(colis.code_livraison) : null,
        p_montant_livraison: Number(colis.montant_livraison || 0),
        p_reponse: resultat,
        p_erreur: null,
      });
    if (finalisationError) return json({ error: finalisationError.message }, 500);

    await traiterNotificationsEmail(admin, commande.id, 10);
    return new Response(JSON.stringify({ data: finalisation }), {
      status: 200,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Transmission IKMS impossible." }, 400);
  }
});
