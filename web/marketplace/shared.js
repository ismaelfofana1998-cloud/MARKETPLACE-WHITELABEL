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
} from "../assets/api.js";

export const app = document.querySelector("#market-app");
export const etat = {
  session: null,
  configuration: null,
  panier: 0,
};

export async function initialiser() {
  etat.configuration = await chargerConfiguration();
  appliquerTheme(etat.configuration);
  etat.session = await chargerSession();
  etat.panier = await compterPanier();
}

export function ecranConfiguration() {
  app.innerHTML = `<main class="conteneur conteneur-etroit">
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
  } = options;
  const configuration = etat.configuration;
  const logo = configuration.logo_url
    ? `<img class="marque-logo" src="${escapeHtml(configuration.logo_url)}" alt="">`
    : "";
  const compteLien = etat.session ? "./compte.html" : "./compte.html?mode=connexion";
  const liensDesktop = mode === "boutique"
    ? `<nav class="navigation-desktop"><a href="./index.html" class="${actif === "accueil" ? "actif" : ""}">Accueil</a><a href="./index.html#categories">Categories</a><a href="./index.html#boutiques">Boutiques</a><a href="./marchand.html">Vendre</a></nav>`
    : navigation;
  const mobile = mode === "boutique"
    ? `<nav class="bottom-nav" aria-label="Navigation principale">
        <a href="./index.html" class="${actif === "accueil" ? "actif" : ""}">${icone("house")}<span>Accueil</span></a>
        <a href="./index.html#categories">${icone("layout-grid")}<span>Categories</span></a>
        <a href="./panier.html" class="${actif === "panier" ? "actif" : ""}">${icone("shopping-bag")}<span>Panier</span></a>
        <a href="${compteLien}" class="${actif === "compte" ? "actif" : ""}">${icone("user-round")}<span>Compte</span></a>
      </nav>`
    : "";

  app.innerHTML = `<div class="app">
    <header class="bandeau">
      <div class="bandeau-ligne">
        <a class="marque" href="./index.html">${logo}<span style="color:white">${escapeHtml(configuration.nom.split(" ")[0] || "IKIGAI")}</span><span>${escapeHtml(configuration.nom.split(" ").slice(1).join(" ") || "Market")}</span></a>
        ${espace ? `<span class="bandeau-espace">${escapeHtml(espace)}</span>` : ""}
        ${liensDesktop}
        <div class="bandeau-actions">
          <a class="icone-btn" href="./panier.html" title="Panier" aria-label="Panier">${icone("shopping-bag")}${etat.panier ? `<span class="compteur">${etat.panier}</span>` : ""}</a>
          <a class="icone-btn" href="${compteLien}" title="Compte" aria-label="Compte">${icone(etat.session ? "circle-user-round" : "log-in")}</a>
        </div>
      </div>
    </header>
    ${contenu}
    ${mobile}
  </div>`;
  rafraichirIcones(app);
}

export async function compterPanier() {
  if (!supabase || !etat.session) return 0;
  const { data } = await supabase
    .from("lignes_panier")
    .select("quantite, paniers!inner(identite_id, statut)")
    .eq("paniers.identite_id", etat.session.user.id)
    .eq("paniers.statut", "ACTIF");
  return (data || []).reduce((total, ligne) => total + Number(ligne.quantite || 0), 0);
}

export async function actualiserCompteurPanier() {
  etat.panier = await compterPanier();
  document.querySelectorAll(".compteur").forEach((element) => element.remove());
  if (!etat.panier) return;
  document.querySelectorAll('a[href="./panier.html"] .lucide-shopping-bag').forEach((iconePanier) => {
    iconePanier.parentElement.insertAdjacentHTML("beforeend", `<span class="compteur">${etat.panier}</span>`);
  });
}

export function demanderConnexion(retour = location.pathname + location.search) {
  location.href = `./compte.html?retour=${encodeURIComponent(retour)}`;
}

export async function exigerConnexion(retour = location.pathname + location.search) {
  if (etat.session) return true;
  demanderConnexion(retour);
  return false;
}

export async function chargerCategories() {
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
  return data || [];
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
    image: imageProduit(produit),
  };
}

export async function chargerProduits(filtres = {}) {
  const construireRequete = (avecExtension = true) => {
    let requete = supabase
    .from("produits")
    .select(`id, boutique_id, categorie_id, nom, slug, description, ${avecExtension ? "marque," : ""} prix, prix_barre, images, statut, cree_le, boutiques!inner(id, nom, slug, logo_url, statut, frais_livraison_base), variantes_produit(id, nom, prix, actif, stocks(quantite, seuil_alerte)), avis_produits(note)`)
    .in("statut", ["ACTIF", "EPUISE"])
    .eq("boutiques.statut", "PUBLIEE")
    .order("cree_le", { ascending: false })
    .limit(filtres.limit || 60);
    if (filtres.categorieId) requete = requete.eq("categorie_id", filtres.categorieId);
    if (filtres.boutiqueId) requete = requete.eq("boutique_id", filtres.boutiqueId);
    return requete;
  };
  let { data, error } = await construireRequete(true);
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const ancienSchema = await construireRequete(false);
    data = ancienSchema.data;
    error = ancienSchema.error;
  }
  if (error) throw error;
  let produits = (data || []).map(normaliserProduit);
  if (filtres.recherche) {
    const recherche = filtres.recherche.toLocaleLowerCase("fr");
    produits = produits.filter((produit) =>
      `${produit.nom} ${produit.marque || ""} ${produit.boutique?.nom || ""}`.toLocaleLowerCase("fr").includes(recherche)
    );
  }
  return produits;
}

export function carteProduit(produit, favoris = new Set()) {
  return `<article class="produit" data-produit="${produit.id}">
    <button class="favori ${favoris.has(produit.id) ? "actif" : ""}" data-favori="${produit.id}" title="Favori" aria-label="Ajouter aux favoris">${icone("heart")}</button>
    ${produit.stock <= 0 ? '<span class="badge badge-danger stock-epuise">Epuise</span>' : ""}
    <a href="./produit.html?id=${produit.id}">
      <img class="produit-image" src="${escapeHtml(produit.image)}" alt="${escapeHtml(produit.nom)}" loading="lazy">
      <div class="produit-corps">
        <div class="produit-boutique">${escapeHtml(produit.boutique?.nom || "Boutique")}</div>
        <h3 class="produit-nom">${escapeHtml(produit.nom)}</h3>
        <span class="produit-prix">${fcfa(produit.prix)}</span>
        ${produit.prix_barre ? `<span class="prix-barre">${fcfa(produit.prix_barre)}</span>` : ""}
        <div class="note">${produit.note ? `${icone("star")} ${produit.note.toFixed(1)} (${produit.avis_produits.length})` : "Nouveau"}</div>
      </div>
    </a>
  </article>`;
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
      if (!etat.session) return demanderConnexion(location.pathname + location.search);
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
