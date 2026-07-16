import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const config = window.IKIGAI_CONFIG || {};

export const configurationManquante = !config.supabaseUrl || !config.supabasePublishableKey;
export const supabase = configurationManquante
  ? null
  : createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

export function urlConfirmationCourante() {
  const url = new URL(location.href);
  url.hash = "";
  return url.href;
}

export function urlIdentity(mode = null) {
  const url = new URL("../identity/index.html", import.meta.url);
  if (mode) url.searchParams.set("mode", mode);
  return url.href;
}

export const IMAGE_PRODUIT_DEFAUT =
  "https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=1000&q=82";

export const configurationDefaut = {
  id: 1,
  nom: "IKIGAI Market",
  slogan: "Les boutiques d'ici, livrees par IKIGAI.",
  description: "Achetez aupres de commerces locaux et suivez chaque livraison.",
  logo_url: null,
  hero_image_url: IMAGE_PRODUIT_DEFAUT,
  couleur_primaire: "#C75332",
  couleur_secondaire: "#17211F",
  couleur_accent: "#E9AE36",
  email_support: null,
  telephone_support: null,
};

export const fcfa = (value) =>
  `${new Intl.NumberFormat("fr-FR").format(Number(value || 0))} FCFA`;

export const formatDate = (value, avecHeure = false) => {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    ...(avecHeure ? { timeStyle: "short" } : {}),
  }).format(new Date(value));
};

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);

export const slugifier = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const imageProduit = (produit) =>
  produit?.images?.find(Boolean) || produit?.image_url || IMAGE_PRODUIT_DEFAUT;

export const libellesStatut = {
  NOUVELLE: "Nouvelle",
  CONFIRMEE: "Confirmee",
  EN_PREPARATION: "En preparation",
  PRETE: "Prete",
  EN_LIVRAISON: "En livraison",
  LIVREE: "Livree",
  ANNULEE: "Annulee",
  BROUILLON: "Brouillon",
  PUBLIEE: "Publiee",
  SUSPENDUE: "Suspendue",
  ACTIF: "Actif",
  EPUISE: "Epuise",
  ARCHIVE: "Archive",
  A_ENVOYER: "A envoyer",
  ENVOYEE: "Envoyee",
  ACCEPTEE: "Acceptee",
  EN_COURS: "En cours",
  ERREUR: "Erreur",
};

export const libelleStatut = (statut) =>
  libellesStatut[statut] || String(statut || "").replaceAll("_", " ");

export const tonaliteStatut = (statut) => {
  if (["LIVREE", "ACTIF", "PUBLIEE", "CONFIRME", "PAYE"].includes(statut)) return "succes";
  if (["ANNULEE", "SUSPENDUE", "ERREUR", "ECHOUE"].includes(statut)) return "danger";
  if (["NOUVELLE", "CONFIRMEE", "EN_PREPARATION", "PRETE", "EN_LIVRAISON", "A_ENVOYER"].includes(statut)) return "attention";
  return "neutre";
};

export const icone = (nom, classe = "") =>
  `<i data-lucide="${escapeHtml(nom)}" class="${escapeHtml(classe)}" aria-hidden="true"></i>`;

export function rafraichirIcones(racine = document) {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.9 }, root: racine });
  }
}

export function toast(message, erreur = false) {
  document.querySelectorAll(".toast").forEach((element) => element.remove());
  const element = document.createElement("div");
  element.className = `toast ${erreur ? "toast-erreur" : ""}`;
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.append(element);
  requestAnimationFrame(() => element.classList.add("visible"));
  window.setTimeout(() => {
    element.classList.remove("visible");
    window.setTimeout(() => element.remove(), 220);
  }, 3200);
}

export function messageErreur(error, fallback = "Une erreur est survenue.") {
  const message = String(error?.message || fallback);
  const traductions = [
    [/Invalid login credentials/i, "Email ou mot de passe incorrect."],
    [/Email not confirmed/i, "Confirme ton adresse email avant de te connecter."],
    [/User already registered/i, "Un compte existe deja avec cet email."],
    [/Password should be at least/i, "Le mot de passe doit contenir au moins 8 caracteres."],
    [/duplicate key.*slug/i, "Cet identifiant est deja utilise."],
    [/Failed to fetch/i, "Connexion au service impossible. Verifie ta connexion internet."],
  ];
  return traductions.find(([pattern]) => pattern.test(message))?.[1] || message;
}

export async function chargerConfiguration() {
  if (!supabase) return configurationDefaut;
  const { data, error } = await supabase
    .from("configuration_marketplace")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) return configurationDefaut;
  return { ...configurationDefaut, ...(data || {}) };
}

export function appliquerTheme(configuration) {
  const root = document.documentElement;
  root.style.setProperty("--primaire", configuration.couleur_primaire || configurationDefaut.couleur_primaire);
  root.style.setProperty("--encre", configuration.couleur_secondaire || configurationDefaut.couleur_secondaire);
  root.style.setProperty("--accent", configuration.couleur_accent || configurationDefaut.couleur_accent);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = configuration.couleur_secondaire || configurationDefaut.couleur_secondaire;
}

export async function chargerSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function televerserImage(file, dossier) {
  if (!file || !supabase) return null;
  if (!file.type.startsWith("image/")) throw new Error("Le fichier doit etre une image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("L'image ne doit pas depasser 5 Mo.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "webp";
  const nom = `${dossier}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("marketplace").upload(nom, file, {
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from("marketplace").getPublicUrl(nom).data.publicUrl;
}

export function boutonOccupe(button, occupe, libelle = "Traitement...") {
  if (!button) return;
  if (occupe) {
    button.dataset.libelleInitial = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icone("loader-circle", "tourne")}<span>${escapeHtml(libelle)}</span>`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.libelleInitial || button.innerHTML;
  }
  rafraichirIcones(button);
}

export function lienRetour(defaut = "./compte.html") {
  const retour = new URLSearchParams(location.search).get("retour");
  if (!retour) return defaut;
  try {
    const cible = new URL(retour, location.href);
    return cible.origin === location.origin ? cible.href : defaut;
  } catch {
    return defaut;
  }
}

export function ongletDepuisUrl(onglets, defaut) {
  try {
    const onglet = decodeURIComponent(location.hash.replace(/^#/, ""));
    return onglets.includes(onglet) ? onglet : defaut;
  } catch {
    return defaut;
  }
}

export function memoriserOnglet(onglet) {
  if (location.hash === `#${onglet}`) return;
  const url = new URL(location.href);
  url.hash = onglet;
  history.pushState({}, "", url);
}
