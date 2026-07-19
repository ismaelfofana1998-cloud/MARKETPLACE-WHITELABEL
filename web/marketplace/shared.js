import {
  appliquerTheme,
  chargerConfiguration,
  chargerSession,
  configurationManquante,
  escapeHtml,
  fcfa,
  icone,
  imageProduit,
  libelleStatut,
  messageErreur,
  rafraichirIcones,
  supabase,
  tonaliteStatut,
  toast,
} from "../assets/api.js?v=18";

export const app = document.querySelector("#market-app");
export const etat = {
  session: null,
  configuration: null,
  panier: 0,
  vitrine: null,
};

let experienceInstallee = false;
let observateurApparition = null;

export function squelettePage(variante = "contenu") {
  if (variante === "catalogue") {
    return `<main class="squelette-page" aria-busy="true" aria-label="Chargement du catalogue">
      <div class="squelette-hero squelette"></div>
      <div class="conteneur">
        <div class="squelette-services">${Array.from({ length: 3 }, () => '<div class="squelette squelette-service"></div>').join("")}</div>
        <div class="squelette-ligne squelette squelette-titre"></div>
        <div class="squelette-categories">${Array.from({ length: 6 }, () => '<div class="squelette squelette-categorie"></div>').join("")}</div>
        <div class="squelette-produits">${Array.from({ length: 8 }, () => '<div class="squelette squelette-produit"></div>').join("")}</div>
      </div>
    </main>`;
  }
  if (variante === "detail") {
    return `<main class="conteneur squelette-page" aria-busy="true" aria-label="Chargement du produit">
      <div class="squelette-detail">
        <div class="squelette squelette-detail-image"></div>
        <div class="squelette-detail-texte">
          <div class="squelette squelette-ligne squelette-courte"></div>
          <div class="squelette squelette-ligne squelette-titre"></div>
          <div class="squelette squelette-ligne"></div>
          <div class="squelette squelette-ligne squelette-moyenne"></div>
          <div class="squelette squelette-action"></div>
        </div>
      </div>
    </main>`;
  }
  return `<main class="conteneur squelette-page" aria-busy="true" aria-label="Chargement de la page">
    <div class="squelette squelette-ligne squelette-titre"></div>
    <div class="squelette squelette-ligne squelette-courte"></div>
    <div class="squelette-contenu">
      <div class="squelette squelette-panneau"></div>
      <div class="squelette squelette-panneau"></div>
    </div>
  </main>`;
}

function preparerImages(racine = app) {
  racine.querySelectorAll("img:not([data-image-preparee])").forEach((image) => {
    image.dataset.imagePreparee = "1";
    const terminer = () => image.classList.add("image-chargee");
    if (image.complete) terminer();
    else {
      image.classList.add("image-en-chargement");
      image.addEventListener("load", terminer, { once: true });
      image.addEventListener("error", terminer, { once: true });
    }
  });
}

function preparerApparitions(racine = app) {
  const mouvementReduit = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const elements = racine.querySelectorAll(".section, .categories-market, .ecosysteme-market, .produit, .boutique-carte, .carte:not(.resume-sticky)");
  elements.forEach((element) => {
    if (element.dataset.apparitionPreparee) return;
    element.dataset.apparitionPreparee = "1";
    if (mouvementReduit || !observateurApparition) {
      element.classList.add("apparition-visible");
      return;
    }
    element.classList.add("apparition");
    observateurApparition.observe(element);
  });
}

export function rafraichirExperience(racine = app) {
  preparerImages(racine);
  preparerApparitions(racine);
}

function installerExperienceGlobale() {
  if (experienceInstallee) return;
  experienceInstallee = true;

  if ("IntersectionObserver" in window) {
    observateurApparition = new IntersectionObserver((entrees, observateur) => {
      entrees.forEach((entree) => {
        if (!entree.isIntersecting) return;
        entree.target.classList.add("apparition-visible");
        observateur.unobserve(entree.target);
      });
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0.06 });
  }

  let miseAJourPlanifiee = false;
  const planifier = () => {
    if (miseAJourPlanifiee) return;
    miseAJourPlanifiee = true;
    requestAnimationFrame(() => {
      miseAJourPlanifiee = false;
      rafraichirExperience(app);
    });
  };
  new MutationObserver(planifier).observe(app, { childList: true, subtree: true });

  const synchroniserBandeau = () => {
    document.querySelector(".bandeau")?.classList.toggle("bandeau-defile", window.scrollY > 12);
  };
  window.addEventListener("scroll", synchroniserBandeau, { passive: true });
  synchroniserBandeau();

  document.addEventListener("click", (event) => {
    const lien = event.target.closest("a[href]");
    if (!lien || event.defaultPrevented || lien.target === "_blank" || lien.hasAttribute("download")) return;
    try {
      const cible = new URL(lien.href, location.href);
      const memePage = cible.pathname === location.pathname && cible.search === location.search;
      if (cible.origin === location.origin && !(memePage && cible.hash)) {
        document.documentElement.classList.add("navigation-en-cours");
      }
    } catch {
      // Lien non navigable.
    }
  });
  window.addEventListener("pageshow", () => document.documentElement.classList.remove("navigation-en-cours"));
}

export async function initialiser() {
  etat.vitrine = await resoudreVitrine();
  const configurationPlateforme = await chargerConfiguration();
  etat.configuration = etat.vitrine
    ? configurationVitrine(configurationPlateforme, etat.vitrine)
    : configurationPlateforme;
  appliquerTheme(etat.configuration);
  appliquerIdentiteVitrine();
  etat.session = await chargerSession();
  etat.panier = await compterPanier();
  installerContexteNavigation();
}

async function resoudreVitrine() {
  if (!supabase) return null;
  const slug = new URLSearchParams(location.search).get("site")?.trim().toLowerCase() || null;
  const hoteGenerique = /^(?:localhost|127\.0\.0\.1|.+\.github\.io)$/i.test(location.hostname);
  const hote = slug || hoteGenerique ? null : (location.hostname || null);
  const { data, error } = await supabase.rpc("rpc_resoudre_vitrine", {
    p_slug: slug,
    p_hote: hote,
  });
  if (error) {
    throw new Error(`Résolution du Site dédié impossible : ${error.message}`);
  }
  if (!data && (slug || hote)) throw new Error("Ce Site dédié est introuvable ou indisponible.");
  return data || null;
}

function configurationVitrine(plateforme, vitrine) {
  const boutique = vitrine.boutique || {};
  const configuration = vitrine.configuration || {};
  return {
    ...plateforme,
    ...configuration,
    nom: configuration.nom_site || boutique.nom || plateforme.nom,
    slogan: configuration.slogan || configuration.annonce || boutique.description || plateforme.slogan,
    description: configuration.description || boutique.description || plateforme.description,
    logo_url: configuration.logo_url || boutique.logo_url || plateforme.logo_url,
    hero_image_url: configuration.hero_images?.find(Boolean) || boutique.banniere_url || plateforme.hero_image_url,
    hero_images: configuration.hero_images?.length
      ? configuration.hero_images
      : [boutique.banniere_url || plateforme.hero_image_url].filter(Boolean),
    email_support: configuration.email_support || plateforme.email_support,
    telephone_support: configuration.telephone_support || boutique.telephone || plateforme.telephone_support,
  };
}

function appliquerIdentiteVitrine() {
  if (!etat.vitrine) return;
  document.body.dataset.vitrine = "site-dedie";
  const configuration = etat.configuration;
  if (configuration.seo_titre || configuration.nom) document.title = configuration.seo_titre || configuration.nom;
  const description = document.querySelector('meta[name="description"]');
  if (description && (configuration.seo_description || configuration.description)) {
    description.content = configuration.seo_description || configuration.description;
  }
  if (configuration.favicon_url) {
    let favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.append(favicon);
    }
    favicon.href = configuration.favicon_url;
  }
}

function installerContexteNavigation() {
  if (!etat.vitrine || document.documentElement.dataset.contexteSiteInstalle) return;
  document.documentElement.dataset.contexteSiteInstalle = "1";
  document.addEventListener("click", (event) => {
    const lien = event.target.closest("a[href]");
    if (!lien || event.defaultPrevented || lien.target === "_blank" || lien.hasAttribute("download")) return;
    try {
      const url = new URL(lien.href, location.href);
      if (url.origin !== location.origin || !/(?:index|produit|panier|checkout|compte)\.html$/.test(url.pathname)) return;
      if (!url.searchParams.has("site")) url.searchParams.set("site", etat.vitrine.boutique.slug);
      lien.href = url.href;
    } catch {
      // Lien non navigable.
    }
  }, true);
}

export const estSiteDedie = () => Boolean(etat.vitrine?.boutique?.id);
export const boutiqueContexteId = () => etat.vitrine?.boutique?.id || null;

export function ecranConfiguration() {
  app.innerHTML = `<main class="conteneur conteneur-etroit page-visible">
    <div class="vide" style="margin-top:60px">
      ${icone("settings")}
      <h1>Connexion Supabase a terminer</h1>
      <p>Renseigne l'URL du projet et la cle publiable dans <strong>web/assets/config.js</strong>.</p>
    </div>
  </main>`;
  rafraichirIcones(app);
}

export function verifierConfiguration() {
  if (!configurationManquante) return true;
  ecranConfiguration();
  return false;
}

export function badgeStatut(statut) {
  return `<span class="badge badge-${tonaliteStatut(statut)}">${escapeHtml(libelleStatut(statut))}</span>`;
}

export function vide(iconeNom, titre, texte = "", action = "") {
  return `<div class="vide">${icone(iconeNom)}<h2>${escapeHtml(titre)}</h2>${texte ? `<p>${escapeHtml(texte)}</p>` : ""}${action}</div>`;
}

export function coquille(contenu, options = {}) {
  const {
    actif = "accueil",
    mode = "boutique",
    espace = "",
    navigation = "",
    actions = null,
  } = options;
  const configuration = etat.configuration;
  const logo = configuration.logo_url
    ? `<img class="marque-logo" src="${escapeHtml(configuration.logo_url)}" alt="">`
    : "";
  const compteLien = etat.session ? "./compte.html" : "./compte.html?mode=connexion";
  const recherche = new URLSearchParams(location.search).get("q") || "";
  const prenom = etat.session?.user?.user_metadata?.prenom || etat.session?.user?.email?.split("@")[0] || "Compte";
  const nomApplication = configuration.nom || "IKIGAI Market";
  const siteDedie = estSiteDedie();
  const masquerAutresBoutiques = siteDedie && configuration.masquer_autres_boutiques !== false;
  const annonce = siteDedie && configuration.annonce
    ? `<div class="annonce-site-dedie">${escapeHtml(configuration.annonce)}</div>`
    : "";
  const marque = `<a class="marque" href="./index.html">${logo}<span style="color:white">${escapeHtml(nomApplication.split(" ")[0] || "IKIGAI")}</span><span>${escapeHtml(nomApplication.split(" ").slice(1).join(" ") || "Market")}</span></a>`;
  const actionsGestion = actions !== null
    ? actions
    : `<div class="bandeau-actions"><a class="icone-btn" href="./panier.html" title="Panier" aria-label="Panier">${icone("shopping-bag")}${etat.panier ? `<span class="compteur">${etat.panier}</span>` : ""}</a><a class="icone-btn" href="${compteLien}" title="Compte" aria-label="Compte">${icone(etat.session ? "circle-user-round" : "log-in")}</a></div>`;
  const entete = mode === "boutique"
    ? `<div class="bandeau-ligne bandeau-commerce">
        ${marque}
        <form class="recherche-entete" id="recherche-entete" action="./index.html" role="search">
          ${siteDedie ? `<input type="hidden" name="site" value="${escapeHtml(etat.vitrine.boutique.slug)}">` : ""}
          <input id="recherche-entete-input" name="q" type="search" maxlength="100" value="${escapeHtml(recherche)}" placeholder="Rechercher dans ${escapeHtml(nomApplication)}" autocomplete="off" aria-label="Rechercher dans ${escapeHtml(nomApplication)}">
          <button type="submit" aria-label="Rechercher">${icone("search")}</button>
          <div class="suggestions-recherche masque" id="suggestions-recherche" role="listbox"></div>
        </form>
        <div class="bandeau-actions actions-commerce">
          <a class="action-commerce action-compte" href="${compteLien}"><span class="action-commerce-label">Bonjour ${escapeHtml(prenom)}</span><strong>Compte</strong></a>
          <a class="action-commerce" href="./compte.html"><span class="action-commerce-label">Retours</span><strong>Commandes</strong></a>
          <a class="icone-btn panier-entete" href="./panier.html" title="Panier" aria-label="Panier">${icone("shopping-cart")}${etat.panier ? `<span class="compteur">${etat.panier}</span>` : ""}<strong>Panier</strong></a>
        </div>
      </div>
      <div class="sous-navigation"><nav><a href="./index.html#produits">${icone("shopping-bag")} Produits</a>${masquerAutresBoutiques ? "" : '<a href="./index.html#boutiques">Boutiques</a><a class="navigation-vendre" href="./vendre.html">Vendre</a>'}</nav><span>Livraison suivie par IKIGAI</span></div>`
    : `<div class="bandeau-ligne">${marque}${espace ? `<span class="bandeau-espace">${escapeHtml(espace)}</span>` : ""}${navigation}${actionsGestion}</div>`;
  const mobile = mode === "boutique"
    ? `<nav class="bottom-nav" aria-label="Navigation principale">
        <a href="./index.html" data-nav-mobile="accueil">${icone("house")}<span>Accueil</span></a>
        <a href="./index.html#produits" data-nav-mobile="produits">${icone("layout-grid")}<span>Produits</span></a>
        <a href="./panier.html" data-nav-mobile="panier">${icone("shopping-bag")}<span>Panier</span></a>
        <a href="${compteLien}" data-nav-mobile="compte">${icone("user-round")}<span>Compte</span></a>
      </nav>`
    : "";

  app.innerHTML = `<div class="app">
    <header class="bandeau">
      ${annonce}
      ${entete}
    </header>
    ${contenu}
    ${mobile}
  </div>`;
  installerExperienceGlobale();
  requestAnimationFrame(() => {
    document.querySelector("main")?.classList.add("page-visible");
    rafraichirExperience(app);
  });
  rafraichirIcones(app);
  if (mode === "boutique") {
    brancherRechercheEntete();
    synchroniserNavigationMobile(actif);
  }
}

function synchroniserNavigationMobile(actif) {
  const section = actif === "accueil" && location.hash === "#produits" ? "produits" : actif;
  document.querySelectorAll("[data-nav-mobile]").forEach((lien) => {
    lien.classList.toggle("actif", lien.dataset.navMobile === section);
  });
  window.addEventListener("hashchange", () => synchroniserNavigationMobile(actif), { once: true });
}

function brancherRechercheEntete() {
  const input = document.querySelector("#recherche-entete-input");
  const suggestions = document.querySelector("#suggestions-recherche");
  if (!input || !suggestions) return;
  let requeteCourante = 0;
  let minuteur;

  const fermer = () => suggestions.classList.add("masque");
  input.addEventListener("input", () => {
    clearTimeout(minuteur);
    const recherche = input.value.trim();
    if (recherche.length < 2) return fermer();
    const numero = ++requeteCourante;
    minuteur = setTimeout(async () => {
      const { data, error } = estSiteDedie()
        ? await supabase.rpc("rpc_rechercher_produits_vitrine", {
            p_boutique_id: boutiqueContexteId(), p_recherche: recherche,
            p_tri: "PERTINENCE", p_page: 1, p_par_page: 6,
          })
        : await supabase.rpc("rpc_rechercher_produits_marketplace", {
            p_recherche: recherche, p_tri: "PERTINENCE", p_page: 1, p_par_page: 6,
          });
      if (numero !== requeteCourante || error) return fermer();
      suggestions.innerHTML = data?.length
        ? data.map((produit) => `<a href="./produit.html?id=${produit.id}" role="option"><img src="${escapeHtml(imageProduit(produit))}" alt=""><span><strong>${escapeHtml(produit.nom)}</strong><small>${escapeHtml(produit.boutique_nom)} - ${fcfa(produit.prix)}</small></span></a>`).join("")
        : `<a href="./index.html?q=${encodeURIComponent(recherche)}"><span><strong>Aucun produit exact</strong><small>Voir tous les résultats proches</small></span></a>`;
      suggestions.classList.remove("masque");
    }, 260);
  });
  input.addEventListener("keydown", (event) => { if (event.key === "Escape") fermer(); });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#recherche-entete")) fermer();
  });
}

export async function compterPanier() {
  if (!supabase || !etat.session) return 0;
  let requete = supabase
    .from("lignes_panier")
    .select("quantite, paniers!inner(identite_id, statut, boutique_contexte_id)")
    .eq("paniers.identite_id", etat.session.user.id)
    .eq("paniers.statut", "ACTIF");
  requete = boutiqueContexteId()
    ? requete.eq("paniers.boutique_contexte_id", boutiqueContexteId())
    : requete.is("paniers.boutique_contexte_id", null);
  const { data } = await requete;
  return (data || []).reduce((total, ligne) => total + Number(ligne.quantite || 0), 0);
}

export async function actualiserCompteurPanier() {
  etat.panier = await compterPanier();
  document.querySelectorAll(".compteur").forEach((element) => element.remove());
  if (!etat.panier) return;
  document.querySelectorAll('a[href*="panier.html"] .lucide-shopping-bag, a[href*="panier.html"] .lucide-shopping-cart').forEach((iconePanier) => {
    iconePanier.parentElement.insertAdjacentHTML("beforeend", `<span class="compteur">${etat.panier}</span>`);
  });
}

export function demanderConnexion(retour = location.pathname + location.search + location.hash) {
  location.href = `./compte.html?retour=${encodeURIComponent(retour)}`;
}

export async function exigerConnexion(retour = location.pathname + location.search + location.hash) {
  if (etat.session) return true;
  demanderConnexion(retour);
  return false;
}

export async function chargerCategories() {
  if (estSiteDedie()) {
    const { data: categoriesBoutique, error: erreurBoutique } = await supabase
      .from("categories_boutique")
      .select("id, nom, slug, description, image_url, ordre")
      .eq("boutique_id", boutiqueContexteId())
      .eq("actif", true)
      .order("ordre")
      .order("nom");
    if (erreurBoutique) throw erreurBoutique;
    if (etat.configuration.masquer_categories_globales !== false) return corrigerNomsCategories(categoriesBoutique);
    const categoriesGlobales = await chargerCategoriesGlobales();
    return [...corrigerNomsCategories(categoriesBoutique), ...categoriesGlobales];
  }
  return chargerCategoriesGlobales();
}

async function chargerCategoriesGlobales() {
  let { data, error } = await supabase
    .from("categories_marketplace")
    .select("id, parent_id, nom, slug, description, image_url, ordre")
    .eq("actif", true)
    .order("ordre")
    .order("nom");
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const ancienSchema = await supabase
      .from("categories_marketplace")
      .select("id, parent_id, nom, slug, image_url, ordre")
      .eq("actif", true)
      .order("ordre")
      .order("nom");
    data = ancienSchema.data;
    error = ancienSchema.error;
  }
  if (error) throw error;
  return corrigerNomsCategories(data);
}

function corrigerNomsCategories(categories = []) {
  const corrections = {
    Beaute: "Beauté",
    Epicerie: "Épicerie",
  };
  return (categories || []).map((categorie) => ({
    ...categorie,
    nom: corrections[categorie.nom] || categorie.nom,
  }));
}

export function normaliserProduit(produit) {
  const variantes = produit.variantes_produit || [];
  const stock = variantes.reduce((total, variante) => {
    const valeur = Array.isArray(variante.stocks) ? variante.stocks[0]?.quantite : variante.stocks?.quantite;
    return total + Number(valeur || 0);
  }, 0);
  const avis = produit.avis_produits || [];
  const note = avis.length
    ? avis.reduce((total, avisProduit) => total + Number(avisProduit.note || 0), 0) / avis.length
    : null;
  return {
    ...produit,
    boutique: Array.isArray(produit.boutiques) ? produit.boutiques[0] : produit.boutiques,
    variantes,
    stock,
    note,
    avis_count: avis.length,
    image: imageProduit(produit),
  };
}

export async function chargerProduits(filtres = {}) {
  const parametres = {
    p_recherche: filtres.recherche || null,
    p_categorie_id: filtres.categorieId || null,
    p_prix_min: Number.isFinite(filtres.prixMin) ? filtres.prixMin : null,
    p_prix_max: Number.isFinite(filtres.prixMax) ? filtres.prixMax : null,
    p_note_min: Number.isFinite(filtres.noteMin) ? filtres.noteMin : null,
    p_en_stock: Boolean(filtres.enStock),
    p_tri: filtres.tri || "PERTINENCE",
    p_page: filtres.page || 1,
    p_par_page: filtres.parPage || filtres.limit || 24,
  };
  const { data, error } = estSiteDedie()
    ? await supabase.rpc("rpc_rechercher_produits_vitrine", {
        ...parametres,
        p_boutique_id: boutiqueContexteId(),
      })
    : await supabase.rpc("rpc_rechercher_produits_marketplace", {
        ...parametres,
        p_boutique_id: filtres.boutiqueId || null,
      });
  if (error) throw error;
  const produits = (data || []).map((produit) => ({
    ...produit,
    boutique: {
      id: produit.boutique_id,
      nom: produit.boutique_nom,
      slug: produit.boutique_slug,
      logo_url: produit.boutique_logo_url,
      frais_livraison_base: produit.boutique_frais_livraison,
    },
    variantes: produit.variante_id ? [{ id: produit.variante_id, nom: "Standard", actif: true }] : [],
    stock: Number(produit.stock_total || 0),
    note: Number(produit.note_moyenne || 0) || null,
    avis_count: Number(produit.avis_count || 0),
    image: imageProduit(produit),
  }));
  return {
    produits,
    total: Number(data?.[0]?.total_resultats || 0),
    page: filtres.page || 1,
    parPage: filtres.parPage || filtres.limit || 24,
  };
}

export function carteProduit(produit, favoris = new Set()) {
  const reduction = produit.prix_barre > produit.prix
    ? Math.round((1 - produit.prix / produit.prix_barre) * 100)
    : 0;
  const varianteId = produit.variante_id || produit.variantes?.[0]?.id || "";
  return `<article class="produit" data-produit="${produit.id}">
    <button class="favori ${favoris.has(produit.id) ? "actif" : ""}" data-favori="${produit.id}" title="Favori" aria-label="Ajouter aux favoris">${icone("heart")}</button>
    ${reduction ? `<span class="remise-produit">-${reduction}%</span>` : ""}
    ${produit.stock <= 0 ? '<span class="badge badge-danger stock-epuise">Épuisé</span>' : ""}
    <a class="produit-visuel" href="./produit.html?id=${produit.id}">
      <img class="produit-image" src="${escapeHtml(produit.image)}" alt="${escapeHtml(produit.nom)}" loading="lazy">
    </a>
    <div class="produit-corps">
      <div class="produit-boutique">${escapeHtml(produit.boutique?.nom || "Boutique")}</div>
      <a href="./produit.html?id=${produit.id}"><h3 class="produit-nom">${escapeHtml(produit.nom)}</h3></a>
      <div><span class="produit-prix">${fcfa(produit.prix)}</span>${produit.prix_barre ? `<span class="prix-barre">${fcfa(produit.prix_barre)}</span>` : ""}</div>
      <div class="note">${produit.note ? `${icone("star")} ${produit.note.toFixed(1)} <span>(${produit.avis_count || produit.avis_produits?.length || 0})</span>` : "Nouveau"}</div>
      <p class="livraison-produit">${icone("truck")} Livraison suivie IKIGAI</p>
      <button class="btn-ajouter-produit" data-ajouter-panier="${varianteId}" ${produit.stock <= 0 || !varianteId ? "disabled" : ""}>${icone("shopping-cart")} ${produit.stock > 0 ? "Ajouter" : "Indisponible"}</button>
    </div>
  </article>`;
}

export function brancherAjoutsPanier(racine) {
  racine.querySelectorAll("[data-ajouter-panier]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!etat.session) return demanderConnexion();
      const varianteId = button.dataset.ajouterPanier;
      if (!varianteId) return;
      button.disabled = true;
      const { error } = await supabase.rpc("rpc_ajouter_au_panier", {
        p_variante_id: varianteId,
        p_quantite: 1,
        p_boutique_contexte_id: boutiqueContexteId(),
      });
      button.disabled = false;
      if (error) return gererErreur(error);
      await actualiserCompteurPanier();
      toast("Produit ajoute au panier");
    });
  });
}

export async function chargerFavoris() {
  if (!etat.session) return new Set();
  const { data } = await supabase
    .from("favoris_marketplace")
    .select("produit_id")
    .eq("identite_id", etat.session.user.id);
  return new Set((data || []).map((favori) => favori.produit_id));
}

export function brancherFavoris(racine, favoris) {
  racine.querySelectorAll("[data-favori]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!etat.session) return demanderConnexion();
      const produitId = button.dataset.favori;
      const actif = favoris.has(produitId);
      const requete = actif
        ? supabase.from("favoris_marketplace").delete().eq("identite_id", etat.session.user.id).eq("produit_id", produitId)
        : supabase.from("favoris_marketplace").insert({ identite_id: etat.session.user.id, produit_id: produitId });
      const { error } = await requete;
      if (error) return toast(messageErreur(error), true);
      if (actif) favoris.delete(produitId); else favoris.add(produitId);
      button.classList.toggle("actif", !actif);
      toast(actif ? "Retire des favoris" : "Ajoute aux favoris");
    });
  });
}

export function gererErreur(error, fallback) {
  const message = messageErreur(error, fallback);
  toast(message, true);
  return message;
}
