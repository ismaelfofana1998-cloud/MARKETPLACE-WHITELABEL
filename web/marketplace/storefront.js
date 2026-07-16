import {
  boutonOccupe,
  escapeHtml,
  fcfa,
  icone,
  imageProduit,
  messageErreur,
  rafraichirIcones,
  supabase,
  toast,
} from "../assets/api.js";
import {
  actualiserCompteurPanier,
  app,
  badgeStatut,
  brancherAjoutsPanier,
  brancherFavoris,
  carteProduit,
  chargerCategories,
  chargerFavoris,
  chargerProduits,
  coquille,
  demanderConnexion,
  etat,
  gererErreur,
  normaliserProduit,
  vide,
} from "./shared.js";

async function chargerBoutiques() {
  const { data, error } = await supabase
    .from("boutiques")
    .select("id, nom, slug, description, logo_url, banniere_url, note_moyenne")
    .eq("statut", "PUBLIEE")
    .order("note_moyenne", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

export async function rendreAccueil() {
  const lireNombre = (valeur) => {
    if (valeur === null || valeur === "") return null;
    const nombre = Number(valeur);
    return Number.isFinite(nombre) && nombre >= 0 ? nombre : null;
  };
  const lireFiltres = () => {
    const params = new URLSearchParams(location.search);
    return {
      recherche: (params.get("q") || "").trim().slice(0, 100),
      categorieId: params.get("categorie") || "",
      boutiqueId: params.get("boutique") || "",
      prixMin: lireNombre(params.get("prix_min")),
      prixMax: lireNombre(params.get("prix_max")),
      noteMin: lireNombre(params.get("note")),
      enStock: params.get("stock") === "1",
      tri: ["PERTINENCE", "NOUVEAUTES", "PRIX_ASC", "PRIX_DESC", "NOTE"].includes(params.get("tri")) ? params.get("tri") : "PERTINENCE",
      page: Math.max(1, Math.min(1000, Number(params.get("page")) || 1)),
      parPage: 24,
    };
  };
  let filtres = lireFiltres();
  coquille('<main><div class="conteneur"><div class="vide">Chargement du catalogue...</div></div></main>', { actif: "accueil" });

  try {
    const [categories, boutiques, favoris] = await Promise.all([
      chargerCategories(),
      chargerBoutiques(),
      chargerFavoris(),
    ]);
    const main = document.querySelector("main");
    main.innerHTML = `<section class="promo-market"><div class="promo-market-contenu"><h1>${escapeHtml(etat.configuration.nom || "IKIGAI Market")}</h1><p>${escapeHtml(etat.configuration.slogan || etat.configuration.description)}</p><a href="#produits">Explorer le catalogue ${icone("arrow-down")}</a></div></section>
      <div class="services-market"><div><span>${icone("truck")}</span><p><strong>Livraison IKIGAI</strong><small>Suivi de la commande a la remise</small></p></div><div><span>${icone("shield-check")}</span><p><strong>Marchands identifies</strong><small>Boutiques et equipes controlees</small></p></div><div><span>${icone("rotate-ccw")}</span><p><strong>Commandes centralisees</strong><small>Retours et historique dans votre compte</small></p></div></div>
      <div class="conteneur catalogue-conteneur">
        <section class="section categories-market" id="categories">
          <div class="entete-page"><div><h2>Parcourir les categories</h2><p class="muted petit">Acces rapide aux rayons du catalogue</p></div></div>
          ${categories.length ? `<div class="grille-categories"><button class="categorie" data-categorie=""><img src="${escapeHtml(etat.configuration.hero_image_url)}" alt=""><span>Tout le catalogue</span></button>${categories.map((categorie) => `<button class="categorie" data-categorie="${categorie.id}"><img src="${escapeHtml(categorie.image_url || etat.configuration.hero_image_url)}" alt=""><span>${escapeHtml(categorie.nom)}</span></button>`).join("")}</div>` : vide("layout-grid", "Les categories arrivent", "Les produits restent accessibles dans le catalogue.")}
        </section>
        <section class="catalogue-layout" id="produits">
          <aside class="filtres-catalogue" id="filtres-catalogue" aria-label="Filtres du catalogue">
            <div class="filtres-entete"><h2>Filtrer</h2><button class="dialogue-fermer fermer-filtres" type="button" aria-label="Fermer">${icone("x")}</button></div>
            <form id="filtres-form">
              <div class="champ"><label for="filtre-categorie">Categorie</label><select id="filtre-categorie" name="categorie"><option value="">Toutes les categories</option>${categories.map((categorie) => `<option value="${categorie.id}">${escapeHtml(categorie.nom)}</option>`).join("")}</select></div>
              <div class="champ"><label for="filtre-boutique">Boutique</label><select id="filtre-boutique" name="boutique"><option value="">Tous les marchands</option>${boutiques.map((boutique) => `<option value="${boutique.id}">${escapeHtml(boutique.nom)}</option>`).join("")}</select></div>
              <fieldset class="filtre-groupe"><legend>Prix (FCFA)</legend><div class="grille-prix"><input name="prix_min" type="number" min="0" max="2000000000" step="100" placeholder="Minimum"><input name="prix_max" type="number" min="0" max="2000000000" step="100" placeholder="Maximum"></div></fieldset>
              <fieldset class="filtre-groupe"><legend>Avis clients</legend><label class="option-filtre"><input type="radio" name="note" value="" checked> Toutes les notes</label><label class="option-filtre"><input type="radio" name="note" value="4"> ${icone("star")} 4 et plus</label><label class="option-filtre"><input type="radio" name="note" value="3"> ${icone("star")} 3 et plus</label></fieldset>
              <label class="case filtre-stock"><input type="checkbox" name="stock" value="1"><span><strong>Disponible maintenant</strong><br><small class="muted">Masquer les articles epuises</small></span></label>
              <button class="btn btn-primaire btn-bloc" type="submit">${icone("list-filter")} Appliquer</button>
              <button class="btn btn-texte btn-bloc" type="button" id="effacer-filtres">Tout effacer</button>
            </form>
          </aside>
          <section class="resultats-catalogue">
            <div class="resultats-entete"><div><p class="sur-titre" id="contexte-resultats">Catalogue IKIGAI</p><h2 id="titre-resultats">Produits disponibles</h2><p class="muted petit" id="resultat-compte">Recherche en cours...</p></div><div class="outils-resultats"><button class="btn btn-secondaire ouvrir-filtres" type="button">${icone("list-filter")} Filtres</button><label for="tri-produits">Trier par</label><select id="tri-produits"><option value="PERTINENCE">Pertinence</option><option value="NOUVEAUTES">Nouveautes</option><option value="PRIX_ASC">Prix croissant</option><option value="PRIX_DESC">Prix decroissant</option><option value="NOTE">Mieux notes</option></select></div></div>
            <div class="filtres-actifs" id="filtres-actifs"></div>
            <div class="grille-produits" id="grille-produits"><div class="vide">Chargement des produits...</div></div>
            <nav class="pagination" id="pagination" aria-label="Pagination du catalogue"></nav>
          </section>
        </section>
        <section class="section" id="boutiques"><div class="entete-page"><div><h2>Boutiques a decouvrir</h2><p class="muted petit">Achetez directement aupres de marchands partenaires</p></div></div><div class="grille-boutiques">${boutiques.slice(0, 9).map((boutique) => `<a class="carte carte-lien boutique-carte" href="./index.html?boutique=${boutique.id}#produits"><img class="boutique-logo" src="${escapeHtml(boutique.logo_url || etat.configuration.hero_image_url)}" alt=""><div><h3>${escapeHtml(boutique.nom)}</h3><p class="muted petit">${escapeHtml(boutique.description || "Boutique partenaire IKIGAI Market")}</p>${boutique.note_moyenne ? `<span class="note">${icone("star")} ${Number(boutique.note_moyenne).toFixed(1)}</span>` : ""}</div></a>`).join("") || vide("store", "Aucune boutique publiee", "La premiere boutique apparaitra ici des sa publication.")}</div></section>
      </div>
      <div class="fond-filtres" id="fond-filtres"></div>`;
    document.querySelector(".promo-market").style.backgroundImage = `url("${String(etat.configuration.hero_image_url || "").replace(/["\\]/g, "")}")`;

    const form = document.querySelector("#filtres-form");
    const grille = document.querySelector("#grille-produits");
    const synchroniserFormulaire = () => {
      form.elements.categorie.value = filtres.categorieId;
      form.elements.boutique.value = filtres.boutiqueId;
      form.elements.prix_min.value = filtres.prixMin ?? "";
      form.elements.prix_max.value = filtres.prixMax ?? "";
      form.elements.stock.checked = filtres.enStock;
      const note = form.querySelector(`[name="note"][value="${filtres.noteMin ?? ""}"]`);
      if (note) note.checked = true;
      document.querySelector("#tri-produits").value = filtres.tri;
      document.querySelectorAll("[data-categorie]").forEach((button) => button.classList.toggle("actif", button.dataset.categorie === filtres.categorieId));
    };
    const mettreAJourUrl = () => {
      const params = new URLSearchParams();
      if (filtres.recherche) params.set("q", filtres.recherche);
      if (filtres.categorieId) params.set("categorie", filtres.categorieId);
      if (filtres.boutiqueId) params.set("boutique", filtres.boutiqueId);
      if (filtres.prixMin !== null) params.set("prix_min", filtres.prixMin);
      if (filtres.prixMax !== null) params.set("prix_max", filtres.prixMax);
      if (filtres.noteMin !== null) params.set("note", filtres.noteMin);
      if (filtres.enStock) params.set("stock", "1");
      if (filtres.tri !== "PERTINENCE") params.set("tri", filtres.tri);
      if (filtres.page > 1) params.set("page", filtres.page);
      history.pushState({}, "", `${location.pathname}${params.size ? `?${params}` : ""}#produits`);
    };
    const fermerFiltres = () => {
      document.querySelector("#filtres-catalogue").classList.remove("ouvert");
      document.querySelector("#fond-filtres").classList.remove("visible");
    };
    const afficherFiltresActifs = () => {
      const actifs = [];
      const categorie = categories.find((element) => element.id === filtres.categorieId);
      const boutique = boutiques.find((element) => element.id === filtres.boutiqueId);
      if (filtres.recherche) actifs.push(["recherche", `Recherche : ${filtres.recherche}`]);
      if (categorie) actifs.push(["categorie", categorie.nom]);
      if (boutique) actifs.push(["boutique", boutique.nom]);
      if (filtres.prixMin !== null) actifs.push(["prix_min", `Des ${fcfa(filtres.prixMin)}`]);
      if (filtres.prixMax !== null) actifs.push(["prix_max", `Jusqu'a ${fcfa(filtres.prixMax)}`]);
      if (filtres.noteMin !== null) actifs.push(["note", `${filtres.noteMin} etoiles et plus`]);
      if (filtres.enStock) actifs.push(["stock", "En stock"]);
      document.querySelector("#filtres-actifs").innerHTML = actifs.map(([cle, libelle]) => `<button data-retirer-filtre="${cle}">${escapeHtml(libelle)} ${icone("x")}</button>`).join("");
      document.querySelectorAll("[data-retirer-filtre]").forEach((button) => button.addEventListener("click", async () => {
        const cle = button.dataset.retirerFiltre;
        if (cle === "recherche") filtres.recherche = "";
        if (cle === "categorie") filtres.categorieId = "";
        if (cle === "boutique") filtres.boutiqueId = "";
        if (cle === "prix_min") filtres.prixMin = null;
        if (cle === "prix_max") filtres.prixMax = null;
        if (cle === "note") filtres.noteMin = null;
        if (cle === "stock") filtres.enStock = false;
        filtres.page = 1;
        synchroniserFormulaire();
        mettreAJourUrl();
        await afficherCatalogue();
      }));
      rafraichirIcones(document.querySelector("#filtres-actifs"));
    };
    const afficherCatalogue = async () => {
      grille.classList.add("chargement");
      try {
        const resultat = await chargerProduits(filtres);
        grille.innerHTML = resultat.produits.length
          ? resultat.produits.map((produit) => carteProduit(produit, favoris)).join("")
          : vide("search-x", "Aucun produit trouve", "Essaie une autre recherche ou retire certains filtres.", '<button class="btn btn-secondaire" id="reinitialiser-catalogue">Tout afficher</button>');
        document.querySelector("#resultat-compte").textContent = `${resultat.total} resultat${resultat.total > 1 ? "s" : ""}`;
        document.querySelector("#contexte-resultats").textContent = filtres.recherche ? `Resultats pour "${filtres.recherche}"` : "Catalogue IKIGAI";
        document.querySelector("#titre-resultats").textContent = categories.find((element) => element.id === filtres.categorieId)?.nom || boutiques.find((element) => element.id === filtres.boutiqueId)?.nom || "Produits disponibles";
        const pages = Math.max(1, Math.ceil(resultat.total / resultat.parPage));
        document.querySelector("#pagination").innerHTML = pages > 1 ? `<button ${filtres.page <= 1 ? "disabled" : ""} data-page="${filtres.page - 1}">${icone("chevron-left")} Precedent</button><span>Page ${filtres.page} sur ${pages}</span><button ${filtres.page >= pages ? "disabled" : ""} data-page="${filtres.page + 1}">Suivant ${icone("chevron-right")}</button>` : "";
        document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", async () => {
          filtres.page = Number(button.dataset.page);
          mettreAJourUrl();
          await afficherCatalogue();
          document.querySelector("#produits").scrollIntoView({ behavior: "smooth" });
        }));
        document.querySelector("#reinitialiser-catalogue")?.addEventListener("click", async () => {
          filtres = { recherche: "", categorieId: "", boutiqueId: "", prixMin: null, prixMax: null, noteMin: null, enStock: false, tri: "PERTINENCE", page: 1, parPage: 24 };
          synchroniserFormulaire();
          mettreAJourUrl();
          await afficherCatalogue();
        });
        brancherFavoris(grille, favoris);
        brancherAjoutsPanier(grille);
        afficherFiltresActifs();
        rafraichirIcones(grille.parentElement);
      } catch (error) {
        grille.innerHTML = vide("wifi-off", "Catalogue indisponible", messageErreur(error));
      } finally {
        grille.classList.remove("chargement");
      }
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(form));
      const prixMin = lireNombre(valeurs.prix_min);
      const prixMax = lireNombre(valeurs.prix_max);
      if (prixMin !== null && prixMax !== null && prixMax < prixMin) return toast("Le prix maximum doit etre superieur au prix minimum.", true);
      filtres = { ...filtres, categorieId: valeurs.categorie || "", boutiqueId: valeurs.boutique || "", prixMin, prixMax, noteMin: lireNombre(valeurs.note), enStock: valeurs.stock === "1", page: 1 };
      fermerFiltres();
      synchroniserFormulaire();
      mettreAJourUrl();
      await afficherCatalogue();
    });
    document.querySelector("#tri-produits").addEventListener("change", async (event) => {
      filtres.tri = event.target.value;
      filtres.page = 1;
      mettreAJourUrl();
      await afficherCatalogue();
    });
    document.querySelector("#effacer-filtres").addEventListener("click", async () => {
      filtres = { ...filtres, categorieId: "", boutiqueId: "", prixMin: null, prixMax: null, noteMin: null, enStock: false, page: 1 };
      synchroniserFormulaire();
      mettreAJourUrl();
      await afficherCatalogue();
    });
    document.querySelectorAll("[data-categorie]").forEach((button) => button.addEventListener("click", async () => {
      filtres.categorieId = button.dataset.categorie;
      filtres.page = 1;
      synchroniserFormulaire();
      mettreAJourUrl();
      await afficherCatalogue();
      document.querySelector("#produits").scrollIntoView({ behavior: "smooth" });
    }));
    document.querySelector(".ouvrir-filtres").addEventListener("click", () => {
      document.querySelector("#filtres-catalogue").classList.add("ouvert");
      document.querySelector("#fond-filtres").classList.add("visible");
    });
    document.querySelector(".fermer-filtres").addEventListener("click", fermerFiltres);
    document.querySelector("#fond-filtres").addEventListener("click", fermerFiltres);
    window.addEventListener("popstate", () => location.reload(), { once: true });
    synchroniserFormulaire();
    await afficherCatalogue();
    rafraichirIcones(main);
  } catch (error) {
    document.querySelector("main .conteneur").innerHTML = vide("wifi-off", "Catalogue indisponible", messageErreur(error));
    rafraichirIcones(app);
  }
}

async function chargerProduit(id) {
  const construireRequete = (avecExtension = true) => supabase
    .from("produits")
    .select(`id, boutique_id, categorie_id, nom, slug, description, ${avecExtension ? "marque," : ""} prix, prix_barre, images, statut, cree_le, boutiques!inner(id, nom, slug, description, logo_url, telephone, adresse, statut, frais_livraison_base), variantes_produit(id, nom, prix, actif, attributs, stocks(quantite, seuil_alerte)), avis_produits(note, commentaire, cree_le, identites(prenom, nom))`)
    .eq("id", id)
    .in("statut", ["ACTIF", "EPUISE"])
    .eq("boutiques.statut", "PUBLIEE")
    .maybeSingle();
  let { data, error } = await construireRequete(true);
  if (error?.code === "42703" || error?.code === "PGRST204") {
    const ancienSchema = await construireRequete(false);
    data = ancienSchema.data;
    error = ancienSchema.error;
  }
  if (error) throw error;
  return data ? normaliserProduit(data) : null;
}

export async function rendreProduit() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    coquille(`<main class="conteneur">${vide("package-x", "Produit introuvable", "Le lien ne contient pas d'identifiant produit.")}</main>`);
    return;
  }
  coquille('<main class="conteneur"><div class="vide">Chargement du produit...</div></main>');
  try {
    const [produit, favoris] = await Promise.all([chargerProduit(id), chargerFavoris()]);
    if (!produit) {
      coquille(`<main class="conteneur">${vide("package-x", "Produit indisponible", "Il a peut-etre ete retire du catalogue.", '<a class="btn btn-primaire" href="./index.html">Retour au catalogue</a>')}</main>`);
      return;
    }
    const images = produit.images?.length ? produit.images : [imageProduit(produit)];
    const variantes = produit.variantes.filter((variante) => variante.actif);
    const premiereVariante = variantes[0];
    const avis = produit.avis_produits || [];
    const similairesResultat = produit.categorie_id
      ? await chargerProduits({ categorieId: produit.categorie_id, limit: 6, tri: "NOUVEAUTES" })
      : { produits: [] };
    const similaires = similairesResultat.produits.filter((element) => element.id !== produit.id).slice(0, 5);
    coquille(`<main class="conteneur">
      <nav class="fil-ariane" aria-label="Fil d'Ariane"><a href="./index.html">Accueil</a><span>${icone("chevron-right")}</span><a href="./index.html?categorie=${produit.categorie_id || ""}#produits">Catalogue</a><span>${icone("chevron-right")}</span><strong>${escapeHtml(produit.nom)}</strong></nav>
      <section class="section produit-detail">
        <div><img class="produit-detail-image" id="image-principale" src="${escapeHtml(images[0])}" alt="${escapeHtml(produit.nom)}"><div class="miniatures">${images.map((image, index) => `<button class="miniature ${index === 0 ? "actif" : ""}" data-image="${escapeHtml(image)}"><img src="${escapeHtml(image)}" alt=""></button>`).join("")}</div></div>
        <div>
          <div class="ligne-entre"><p class="muted petit">${escapeHtml(produit.marque || produit.boutique?.nom || "IKIGAI Market")}</p><button class="favori ${favoris.has(produit.id) ? "actif" : ""}" data-favori="${produit.id}" aria-label="Favori">${icone("heart")}</button></div>
          <h1>${escapeHtml(produit.nom)}</h1>
          <div class="note">${produit.note ? `${icone("star")} ${produit.note.toFixed(1)} - ${avis.length} avis` : "Nouveau produit"}</div>
          <div class="prix-detail">${fcfa(produit.prix)} ${produit.prix_barre ? `<span class="prix-barre">${fcfa(produit.prix_barre)}</span>` : ""}</div>
          <p class="muted">${escapeHtml(produit.description || "Ce produit est propose et prepare par un marchand partenaire IKIGAI.")}</p>
          ${variantes.length > 1 ? `<div class="champ"><label>Option</label><select id="variante">${variantes.map((variante) => `<option value="${variante.id}">${escapeHtml(variante.nom)}${variante.prix ? ` - ${fcfa(variante.prix)}` : ""}</option>`).join("")}</select></div>` : ""}
          <p class="petit ${produit.stock > 0 ? "muted" : "badge-danger"}">${produit.stock > 0 ? `${produit.stock} article${produit.stock > 1 ? "s" : ""} disponible${produit.stock > 1 ? "s" : ""}` : "Stock epuise"}</p>
          <div class="ligne"><div class="stepper"><button id="moins" aria-label="Diminuer">${icone("minus")}</button><span id="quantite">1</span><button id="plus" aria-label="Augmenter">${icone("plus")}</button></div><button class="btn btn-primaire" style="flex:1" id="ajouter" ${produit.stock <= 0 ? "disabled" : ""}>${icone("shopping-bag")} Ajouter au panier</button><button class="btn btn-secondaire" id="partager" aria-label="Partager">${icone("share-2")}</button></div>
          <div class="carte achat-garanties" style="margin-top:18px"><div class="ligne"><span class="badge badge-succes">${icone("truck")}</span><div><strong>Livraison suivie par IKIGAI</strong><p class="muted petit" style="margin:4px 0 0">Frais de base : ${fcfa(produit.boutique?.frais_livraison_base)}</p></div></div><div class="engagement-produit"><span>${icone("shield-check")} Paiement et commande securises</span><span>${icone("rotate-ccw")} Historique et retour depuis votre compte</span></div></div>
        </div>
      </section>
      <section class="section"><div class="carte boutique-carte"><img class="boutique-logo" src="${escapeHtml(produit.boutique?.logo_url || images[0])}" alt=""><div><h2>${escapeHtml(produit.boutique?.nom)}</h2><p class="muted petit">${escapeHtml(produit.boutique?.description || produit.boutique?.adresse || "Marchand IKIGAI Market")}</p><a class="btn btn-secondaire" href="./index.html?boutique=${produit.boutique_id}#produits">Voir ses produits</a></div></div></section>
      ${similaires.length ? `<section class="section"><div class="entete-page"><div><h2>Produits similaires</h2><p class="muted petit">Dans la meme categorie</p></div><a class="btn btn-texte" href="./index.html?categorie=${produit.categorie_id}#produits">Tout voir ${icone("arrow-right")}</a></div><div class="grille-produits" id="produits-similaires">${similaires.map((element) => carteProduit(element, favoris)).join("")}</div></section>` : ""}
      <section class="section"><h2>Avis clients</h2><div class="pile">${avis.length ? avis.slice(0, 8).map((avisProduit) => `<article class="carte"><div class="ligne-entre"><strong>${escapeHtml(`${avisProduit.identites?.prenom || "Client"} ${avisProduit.identites?.nom?.[0] || ""}`.trim())}</strong><span class="note">${icone("star")} ${avisProduit.note}/5</span></div><p class="muted petit" style="margin:8px 0 0">${escapeHtml(avisProduit.commentaire || "A recommande ce produit.")}</p></article>`).join("") : '<p class="muted">Aucun avis pour le moment.</p>'}</div></section>
    </main>`);
    brancherFavoris(app, favoris);
    brancherAjoutsPanier(document.querySelector("#produits-similaires") || document.createElement("div"));
    let quantite = 1;
    const afficherQuantite = () => { document.querySelector("#quantite").textContent = quantite; };
    document.querySelector("#moins").addEventListener("click", () => { quantite = Math.max(1, quantite - 1); afficherQuantite(); });
    document.querySelector("#plus").addEventListener("click", () => { quantite = Math.min(Math.max(produit.stock, 1), quantite + 1); afficherQuantite(); });
    document.querySelectorAll("[data-image]").forEach((button) => button.addEventListener("click", () => {
      document.querySelector("#image-principale").src = button.dataset.image;
      document.querySelectorAll("[data-image]").forEach((element) => element.classList.toggle("actif", element === button));
    }));
    document.querySelector("#ajouter").addEventListener("click", async (event) => {
      if (!etat.session) return demanderConnexion();
      const button = event.currentTarget;
      const varianteId = document.querySelector("#variante")?.value || premiereVariante?.id;
      if (!varianteId) return toast("Aucune option disponible.", true);
      boutonOccupe(button, true, "Ajout...");
      const { error } = await supabase.rpc("rpc_ajouter_au_panier", { p_variante_id: varianteId, p_quantite: quantite });
      boutonOccupe(button, false);
      if (error) return gererErreur(error);
      await actualiserCompteurPanier();
      toast("Produit ajoute au panier");
    });
    document.querySelector("#partager").addEventListener("click", async () => {
      if (navigator.share) await navigator.share({ title: produit.nom, text: produit.description || produit.nom, url: location.href });
      else { await navigator.clipboard.writeText(location.href); toast("Lien copie"); }
    });
    rafraichirIcones(app);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Impossible de charger ce produit", messageErreur(error))}</main>`);
  }
}

export async function chargerLignesPanier() {
  if (!etat.session) return [];
  const { data, error } = await supabase
    .from("lignes_panier")
    .select("id, quantite, variante_id, paniers!inner(identite_id, statut), variantes_produit(id, nom, prix, actif, stocks(quantite), produits(id, boutique_id, nom, prix, images, statut, boutiques(id, nom, frais_livraison_base)))")
    .eq("paniers.identite_id", etat.session.user.id)
    .eq("paniers.statut", "ACTIF")
    .order("cree_le");
  if (error) throw error;
  return (data || []).map((ligne) => {
    const variante = Array.isArray(ligne.variantes_produit) ? ligne.variantes_produit[0] : ligne.variantes_produit;
    const produit = Array.isArray(variante?.produits) ? variante.produits[0] : variante?.produits;
    const boutique = Array.isArray(produit?.boutiques) ? produit.boutiques[0] : produit?.boutiques;
    const stockObjet = Array.isArray(variante?.stocks) ? variante.stocks[0] : variante?.stocks;
    return {
      ...ligne,
      variante,
      produit: { ...produit, boutique, image: imageProduit(produit), prix_effectif: Number(variante?.prix ?? produit?.prix ?? 0) },
      stock: Number(stockObjet?.quantite || 0),
    };
  }).filter((ligne) => ligne.produit?.id);
}

export async function rendrePanier() {
  if (!etat.session) {
    coquille(`<main class="conteneur">${vide("shopping-bag", "Connecte-toi pour retrouver ton panier", "Ton panier et tes commandes sont synchronises sur tous tes appareils.", '<button class="btn btn-primaire" id="connexion-panier">Se connecter</button>')}</main>`, { actif: "panier" });
    document.querySelector("#connexion-panier").addEventListener("click", () => demanderConnexion("./panier.html"));
    return;
  }
  coquille('<main class="conteneur"><div class="vide">Chargement du panier...</div></main>', { actif: "panier" });
  try {
    const lignes = await chargerLignesPanier();
    const sousTotal = lignes.reduce((total, ligne) => total + ligne.produit.prix_effectif * ligne.quantite, 0);
    const boutiques = new Map(lignes.map((ligne) => [ligne.produit.boutique.id, ligne.produit.boutique]));
    const frais = [...boutiques.values()].reduce((total, boutique) => total + Number(boutique.frais_livraison_base || 0), 0);
    coquille(`<main class="conteneur"><div class="entete-page"><div><h1>Mon panier</h1><p class="muted">${lignes.length} produit${lignes.length > 1 ? "s" : ""}</p></div></div>${lignes.length ? `<div class="deux-colonnes"><section>${lignes.map((ligne) => `<article class="panier-ligne"><a href="./produit.html?id=${ligne.produit.id}"><img src="${escapeHtml(ligne.produit.image)}" alt="${escapeHtml(ligne.produit.nom)}"></a><div><p class="petit muted">${escapeHtml(ligne.produit.boutique?.nom)}</p><h3>${escapeHtml(ligne.produit.nom)}</h3>${ligne.variante?.nom !== "Standard" ? `<p class="petit muted">${escapeHtml(ligne.variante?.nom)}</p>` : ""}<strong>${fcfa(ligne.produit.prix_effectif)}</strong>${ligne.quantite > ligne.stock ? '<p class="petit" style="color:var(--danger)">Stock insuffisant</p>' : ""}</div><div class="actions-ligne pile"><div class="stepper"><button data-moins="${ligne.id}" aria-label="Diminuer">${icone("minus")}</button><span>${ligne.quantite}</span><button data-plus="${ligne.id}" aria-label="Augmenter">${icone("plus")}</button></div><button class="btn btn-texte" data-supprimer="${ligne.id}">${icone("trash-2")} Retirer</button></div></article>`).join("")}</section><aside class="carte resume-sticky"><h2>Resume</h2><div class="ligne-entre"><span>Sous-total</span><strong>${fcfa(sousTotal)}</strong></div><div class="ligne-entre" style="margin-top:10px"><span>Livraison</span><strong>${fcfa(frais)}</strong></div><hr class="separateur"><div class="ligne-entre"><strong>Total estime</strong><strong>${fcfa(sousTotal + frais)}</strong></div><a class="btn btn-primaire btn-bloc" style="margin-top:18px" href="./checkout.html">Commander ${icone("arrow-right")}</a><a class="btn btn-secondaire btn-bloc" style="margin-top:8px" href="./index.html">Continuer mes achats</a></aside></div>` : vide("shopping-bag", "Ton panier est vide", "Explore les boutiques et ajoute les produits qui te plaisent.", '<a class="btn btn-primaire" href="./index.html">Voir le catalogue</a>')}</main>`, { actif: "panier" });
    const modifier = async (id, quantite) => {
      const { error } = await supabase.rpc("rpc_modifier_ligne_panier", { p_ligne_id: id, p_quantite: quantite });
      if (error) return gererErreur(error);
      await rendrePanier();
    };
    document.querySelectorAll("[data-moins]").forEach((button) => button.addEventListener("click", () => {
      const ligne = lignes.find((element) => element.id === button.dataset.moins);
      modifier(ligne.id, ligne.quantite - 1);
    }));
    document.querySelectorAll("[data-plus]").forEach((button) => button.addEventListener("click", () => {
      const ligne = lignes.find((element) => element.id === button.dataset.plus);
      modifier(ligne.id, ligne.quantite + 1);
    }));
    document.querySelectorAll("[data-supprimer]").forEach((button) => button.addEventListener("click", () => modifier(button.dataset.supprimer, 0)));
    rafraichirIcones(app);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Panier indisponible", messageErreur(error))}</main>`, { actif: "panier" });
  }
}

export async function rendreCheckout() {
  if (!etat.session) return demanderConnexion("./checkout.html");
  coquille('<main class="conteneur"><div class="vide">Preparation de la commande...</div></main>', { actif: "panier" });
  try {
    const [lignes, profilResultat, adressesResultat] = await Promise.all([
      chargerLignesPanier(),
      supabase.from("identites").select("prenom, nom, telephone").eq("id", etat.session.user.id).single(),
      supabase.from("adresses_livraison").select("*").eq("identite_id", etat.session.user.id).order("principale", { ascending: false }).order("cree_le", { ascending: false }),
    ]);
    if (!lignes.length) { location.href = "./panier.html"; return; }
    const profil = profilResultat.data || {};
    const adresses = adressesResultat.data || [];
    const zones = Array.isArray(etat.configuration.zones_livraison) ? etat.configuration.zones_livraison : [];
    const optionsZones = (selection = "") => `${selection && !zones.some((zone) => zone.code === selection) ? `<option value="${escapeHtml(selection)}" selected>${escapeHtml(selection)}</option>` : ""}${zones.map((zone) => `<option value="${escapeHtml(zone.code)}" ${zone.code === selection ? "selected" : ""}>${escapeHtml(zone.nom || zone.code)}</option>`).join("")}`;
    const sousTotal = lignes.reduce((total, ligne) => total + ligne.produit.prix_effectif * ligne.quantite, 0);
    const boutiques = new Map(lignes.map((ligne) => [ligne.produit.boutique.id, ligne.produit.boutique]));
    const frais = [...boutiques.values()].reduce((total, boutique) => total + Number(boutique.frais_livraison_base || 0), 0);
    coquille(`<main class="conteneur"><div class="entete-page"><div><h1>Finaliser la commande</h1><p class="muted">Livraison et paiement</p></div></div><form id="checkout-form" class="deux-colonnes"><section class="pile"><div class="carte"><h2>Adresse de livraison</h2>${adresses.length ? `<div class="champ"><label>Adresse enregistree</label><select name="adresse_id" id="adresse-select">${adresses.map((adresse) => `<option value="${adresse.id}">${escapeHtml(adresse.libelle)} - ${escapeHtml(adresse.adresse)}</option>`).join("")}<option value="nouvelle">Utiliser une nouvelle adresse</option></select></div><div class="champ" id="zone-adresse-existante"><label>Zone de livraison</label>${zones.length ? `<select name="code_zone_existante" required><option value="">Choisir une zone</option>${optionsZones(adresses[0]?.code_zone || "")}</select>` : `<input name="code_zone_existante" value="${escapeHtml(adresses[0]?.code_zone)}" placeholder="COCODY" required>`}</div>` : '<input type="hidden" name="adresse_id" value="nouvelle">'}<div id="nouvelle-adresse" class="${adresses.length ? "masque" : ""}"><div class="grille-deux"><div class="champ"><label>Nom du destinataire</label><input name="destinataire_nom" value="${escapeHtml(`${profil.prenom || ""} ${profil.nom || ""}`.trim())}"></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" value="${escapeHtml(profil.telephone || "")}"></div></div><div class="champ"><label>Adresse</label><input name="adresse" placeholder="Quartier, rue, repere"></div><div class="grille-deux"><div class="champ"><label>Commune</label><input name="commune" placeholder="Cocody"></div><div class="champ"><label>Libelle</label><input name="libelle" value="Domicile"></div></div><div class="champ"><label>Zone de livraison</label>${zones.length ? `<select name="code_zone"><option value="">Choisir une zone</option>${optionsZones()}</select>` : '<input name="code_zone" placeholder="COCODY">'}</div><div class="champ"><label>Indications</label><textarea name="indications" placeholder="Batiment, portail, point de repere..."></textarea></div></div></div><div class="carte"><h2>Paiement</h2><label class="case"><input type="radio" name="mode_paiement" value="A_LA_LIVRAISON" checked><span><strong>Paiement a la livraison</strong><br><span class="muted petit">Payez au moment de la remise de votre commande.</span></span></label><div class="bande-info bande-attention petit" style="margin-top:14px">Wave, Orange Money et carte seront proposes des que les comptes commercants seront configures.</div></div><div class="carte"><h2>Instructions</h2><div class="champ"><label>Note pour le marchand ou le livreur</label><textarea name="note" placeholder="Facultatif"></textarea></div></div></section><aside class="carte resume-sticky"><h2>Votre commande</h2><div class="pile">${lignes.map((ligne) => `<div class="ligne-entre petit"><span>${ligne.quantite} x ${escapeHtml(ligne.produit.nom)}</span><strong>${fcfa(ligne.produit.prix_effectif * ligne.quantite)}</strong></div>`).join("")}</div><hr class="separateur"><div class="ligne-entre"><span>Articles</span><strong>${fcfa(sousTotal)}</strong></div><div class="ligne-entre" style="margin-top:9px"><span>Livraison (${boutiques.size})</span><strong>${fcfa(frais)}</strong></div><hr class="separateur"><div class="ligne-entre"><strong>Total</strong><strong style="font-size:20px">${fcfa(sousTotal + frais)}</strong></div><button class="btn btn-primaire btn-bloc" style="margin-top:18px" id="confirmer">${icone("check")} Confirmer la commande</button><p class="muted petit" style="margin:12px 0 0">Le stock et le montant sont verifies une derniere fois avant validation.</p></aside></form></main>`, { actif: "panier" });
    const adresseSelect = document.querySelector("#adresse-select");
    adresseSelect?.addEventListener("change", () => {
      const nouvelle = adresseSelect.value === "nouvelle";
      document.querySelector("#nouvelle-adresse").classList.toggle("masque", !nouvelle);
      document.querySelector("#zone-adresse-existante")?.classList.toggle("masque", nouvelle);
      const adresse = adresses.find((element) => element.id === adresseSelect.value);
      const champ = document.querySelector('[name="code_zone_existante"]');
      if (champ && adresse) champ.value = adresse.code_zone || "";
    });
    document.querySelector("#checkout-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.querySelector("#confirmer");
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      let adresseId = valeurs.adresse_id;
      if (adresseId === "nouvelle") {
        if (!valeurs.destinataire_nom?.trim() || !valeurs.telephone?.trim() || !valeurs.adresse?.trim() || !valeurs.code_zone?.trim()) return toast("Nom, telephone, adresse et zone sont requis.", true);
        boutonOccupe(button, true, "Enregistrement...");
        const { data, error } = await supabase.from("adresses_livraison").insert({
          identite_id: etat.session.user.id,
          destinataire_nom: valeurs.destinataire_nom.trim(),
          telephone: valeurs.telephone.trim(),
          adresse: valeurs.adresse.trim(),
          commune: valeurs.commune?.trim() || null,
          libelle: valeurs.libelle?.trim() || "Domicile",
          indications: valeurs.indications?.trim() || null,
          code_zone: valeurs.code_zone.trim().toUpperCase(),
          principale: adresses.length === 0,
        }).select("id").single();
        if (error) { boutonOccupe(button, false); return gererErreur(error); }
        adresseId = data.id;
      } else {
        const codeZone = valeurs.code_zone_existante?.trim().toUpperCase();
        if (!codeZone) return toast("Choisis la zone de livraison.", true);
        const adresse = adresses.find((element) => element.id === adresseId);
        if (adresse?.code_zone !== codeZone) {
          const { error: zoneError } = await supabase.from("adresses_livraison").update({ code_zone: codeZone }).eq("id", adresseId);
          if (zoneError) return gererErreur(zoneError);
        }
      }
      boutonOccupe(button, true, "Validation...");
      const { data: achatId, error } = await supabase.rpc("rpc_valider_panier", {
        p_adresse_id: adresseId,
        p_mode_paiement: valeurs.mode_paiement,
        p_note: valeurs.note?.trim() || null,
      });
      if (error) { boutonOccupe(button, false); return gererErreur(error); }
      await supabase.functions.invoke("sync-livraisons", { body: { achat_id: achatId, notifications_uniquement: true } });
      toast("Commande confirmee");
      location.href = `./compte.html?commande=${achatId}`;
    });
    rafraichirIcones(app);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Impossible de finaliser", messageErreur(error), '<a class="btn btn-secondaire" href="./panier.html">Retour au panier</a>')}</main>`, { actif: "panier" });
  }
}
