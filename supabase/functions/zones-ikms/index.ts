import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { json } from "../_shared/operations.ts";
import {
  extraireZonesTarifs,
  minimumTarifs,
  obtenirTarifsIkms,
} from "../_shared/tarifs-ikms.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "Methode non autorisee." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: configuration, error } = await admin
    .rpc("rpc_lire_configuration_ikms_catalogue");

  if (
    error || !configuration?.api_base_url || !configuration?.api_key
  ) {
    return json({
      data: {
        zones: [],
        minimum: Number(configuration?.livraison_a_partir_de || 1000),
        disponible: false,
      },
    });
  }

  const tarifs = await obtenirTarifsIkms({
    boutiqueId: "catalogue-plateforme",
    apiBaseUrl: configuration.api_base_url,
    apiKey: configuration.api_key,
  });

  return json({
    data: {
      zones: extraireZonesTarifs(tarifs).map((code) => ({ code, nom: code })),
      minimum: minimumTarifs(tarifs) ??
        Number(configuration.livraison_a_partir_de || 1000),
      disponible: Array.isArray(tarifs),
    },
  });
});
