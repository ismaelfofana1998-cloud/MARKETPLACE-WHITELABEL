import { urlIkms } from "./operations.ts";

export const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

const APPEL_TIMEOUT_MS = 15_000;

export type TarifIkms = {
  zone_a: string;
  zone_b: string;
  montant: number;
};

export type ConfigurationTarifsIkms = {
  boutiqueId: string;
  apiBaseUrl: unknown;
  apiKey: unknown;
};

type EntreeCache = {
  tarifs: TarifIkms[];
  chargeLe: number;
};

const cacheTarifsIkms = new Map<string, EntreeCache>();
const actualisationsEnCours = new Map<string, Promise<TarifIkms[]>>();

const normaliserZone = (zone: unknown) => String(zone || "").trim().toUpperCase();

function normaliserTarifs(tarifs: unknown): TarifIkms[] {
  if (!Array.isArray(tarifs)) throw new Error("La grille tarifaire IKMS est absente.");
  return tarifs.flatMap((tarif) => {
    if (!tarif || typeof tarif !== "object") return [];
    const valeur = tarif as Record<string, unknown>;
    const zoneA = normaliserZone(valeur.zone_a);
    const zoneB = normaliserZone(valeur.zone_b);
    const montant = Number(valeur.montant);
    if (!zoneA || !zoneB || !Number.isFinite(montant) || montant < 0) return [];
    return [{ zone_a: zoneA, zone_b: zoneB, montant }];
  });
}

export async function obtenirTarifsIkms(
  config: ConfigurationTarifsIkms,
): Promise<TarifIkms[] | null> {
  const boutiqueId = String(config.boutiqueId || "").trim();
  const cacheExistant = cacheTarifsIkms.get(boutiqueId);
  if (cacheExistant && Date.now() - cacheExistant.chargeLe < CACHE_TTL_MS) {
    return cacheExistant.tarifs;
  }

  if (!boutiqueId) return null;

  let actualisation = actualisationsEnCours.get(boutiqueId);
  if (!actualisation) {
    actualisation = (async () => {
      const apiKey = String(config.apiKey || "").trim();
      if (!apiKey) throw new Error("Cle IKMS manquante.");

      const response = await fetch(urlIkms(config.apiBaseUrl, "tarifs"), {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(APPEL_TIMEOUT_MS),
      });
      const resultat = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`IKMS tarifs HTTP ${response.status}`);

      const data = resultat && typeof resultat === "object"
        ? (resultat as Record<string, unknown>).data
        : null;
      const tarifs = normaliserTarifs(
        data && typeof data === "object"
          ? (data as Record<string, unknown>).tarifs
          : null,
      );
      cacheTarifsIkms.set(boutiqueId, { tarifs, chargeLe: Date.now() });
      return tarifs;
    })();
    actualisationsEnCours.set(boutiqueId, actualisation);
    actualisation.finally(() => actualisationsEnCours.delete(boutiqueId)).catch(() => null);
  }

  try {
    return await actualisation;
  } catch (error) {
    console.warn(
      "Grille tarifaire IKMS indisponible, utilisation du cache perime si present.",
      error instanceof Error ? error.message : "Erreur reseau IKMS",
    );
    return cacheExistant?.tarifs ?? null;
  }
}

export function estimerTarif(
  tarifs: TarifIkms[] | null | undefined,
  zoneDepart: unknown,
  zoneArrivee: unknown,
): number | null {
  const depart = normaliserZone(zoneDepart);
  const arrivee = normaliserZone(zoneArrivee);
  if (!depart || !arrivee || !Array.isArray(tarifs)) return null;

  const tarif = tarifs.find((item) =>
    (normaliserZone(item.zone_a) === depart && normaliserZone(item.zone_b) === arrivee) ||
    (normaliserZone(item.zone_a) === arrivee && normaliserZone(item.zone_b) === depart)
  );
  if (!tarif || !Number.isFinite(tarif.montant) || tarif.montant < 0) return null;
  return tarif.montant;
}

export function extraireZonesTarifs(tarifs: TarifIkms[] | null | undefined) {
  const zones = new Set<string>();
  for (const tarif of tarifs || []) {
    const zoneA = normaliserZone(tarif.zone_a);
    const zoneB = normaliserZone(tarif.zone_b);
    if (zoneA) zones.add(zoneA);
    if (zoneB) zones.add(zoneB);
  }
  return [...zones].sort((a, b) => a.localeCompare(b, "fr"));
}

export function minimumTarifs(tarifs: TarifIkms[] | null | undefined): number | null {
  const montants = (tarifs || [])
    .map((tarif) => Number(tarif.montant))
    .filter((montant) => Number.isFinite(montant) && montant >= 0);
  return montants.length ? Math.min(...montants) : null;
}

// Seul data.colis[].montant_livraison renvoye par POST /commandes fait foi.
// Cette estimation sert uniquement a l'affichage avant validation et jamais a la facturation.
