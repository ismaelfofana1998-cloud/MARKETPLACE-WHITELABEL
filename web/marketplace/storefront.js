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
    .limit(9);
  if (error) throw error;
  return data || [];
}

export async function rendreAccueil() {
  coquille(`<main><section class="hero-market"><div class="hero-contenu"><p>Marketplace locale</p><h1>${escapeHtml(etat.configuration.slogan)}</h1><p>${escapeHtml(etat.configuration.description)}</p><form class="recherche-hero" id="recherche-form"><input id="recherche" type="search" placeholder="Produit, marque ou boutique" autocomplete="off"><button aria-label="Rechercher">${icone("search")}</button></form><div class="hero-actions"><a class="btn btn-accent" href="#produits">Voir les produits</a><a class="btn btn-secondaire" href="./marchand.html">Ouvrir une boutique</a></div></div></section><div class="conteneur"><div class="vide">Chargement du catalogue...</div></div></main>`, { actif: "accueil" });
  document.querySelector(".hero-market").style.backgroundImage = `url("${etat.configuration.hero_image_url}")`;

  try {
    const [categories, produits, boutiques, favoris] = await Promise.all([
      chargerCategories(),
      chargerProduits(),
      chargerBoutiques(),
      chargerFavoris(),
    ]);
    const main = document.querySelector("main");
    main.querySelector(".conteneur").outerHTML = `<div class="conteneur">
      <section class="section" id="categories">
        <div class="entete-page"><div><h2>Explorer les categories</h2><p class="muted petit">Tout ce qu'il vous faut, pres de chez vous</p></div></div>
        ${categories.length ? `<div class="grille-categories"><button class="categorie actif" data-categorie=""><img src="${etat.configuration.hero_image_url}" alt=""><span>Tout voir</span></button>${categories.map((categorie) => `<button class="categorie" data-categorie="${categorie.id}"><img src="${escapeHtml(categorie.image_url || etat.configuration.hero_image_url)}" alt=""><span>${escapeHtml(categorie.nom)}</span></button>`).join("")}</div>` : vide("layout-grid", "Les categories arrivent", "Le catalogue peut deja etre alimente depuis l'espace marchand.")}
      </section>
      <section class="section" id="produits">
        <div class="entete-page"><div><h2>Produits disponibles</h2><p class="muted petit" id="resultat-compte">${produits.length} resultat${produits.length > 1 ? "s" : ""}</p></div></div>
        <div class="grille-produits" id="grille-produits"></div>
      </section>
      <section class="section" id="boutiques">
        <div class="entete-page"><div><h2>Boutiques a decouvrir</h2><p class="muted petit">Des marchands verifies sur IKIGAI Market</p></div></div>
        <div class="grille-boutiques">${boutiques.map((boutique) => `<a class="carte carte-lien boutique-carte" href="./index.html?boutique=${boutique.id}#produits"><img class="boutique-logo" src="${escapeHtml(boutique.logo_url || etat.configuration.hero_image_url)}" alt=""><div><h3>${escapeHtml(boutique.nom)}</h3><p class="muted petit">${escapeHtml(boutique.description || "Boutique IKIGAI Market")}</p>${boutique.note_moyenne ? `<span class="note">${icone("star")} ${Number(boutique.note_moyenne).toFixed(1)}</span>` : ""}</div></a>`).join("") || vide("store", "Aucune boutique publiee", "La premiere boutique apparaitra ici des sa publication.")}</div>
      </section>
    </div>`;

    let categorieActive = new URLSearchParams(location.search).get("categorie") || "";
    let boutiqueActive = new URLSearchParams(location.search).get("boutique") || "";
    let rechercheActive = "";
    const grille = document.querySelector("#grille-produits");
    const afficher = () => {
      const recherche = rechercheActive.toLocaleLowerCase("fr");
      const filtres = produits.filter((produit) =>
        (!categorieActive || produit.categorie_id === categorieActive)
        && (!boutiqueActive || produit.boutique_id === boutiqueActive)
        && (!recherche || `${produit.nom} ${produit.marque || ""} ${produit.boutique?.nom || ""}`.toLocaleLowerCase("fr").includes(recherche))
      );
      grille.innerHTML = filtres.length
        ? filtres.map((produit) => carteProduit(produit, favoris)).join("")
        : vide("search-x", "Aucun produit trouve", "Modifie les filtres ou reviens voir les nouveautes.", '<button class="btn btn-secondaire" id="reinitialiser">Reinitialiser</button>');
      document.querySelector("#resultat-compte").textContent = `${filtres.length} resultat${filtres.length > 1 ? "s" : ""}`;
      brancherFavoris(grille, favoris);
      grille.querySelector("#reinitialiser")?.addEventListener("click", () => {
        categorieActive = "";
        boutiqueActive = "";
        rechercheActive = "";
        document.querySelector("#recherche").value = "";
        document.querySelectorAll("[data-categorie]").forEach((button) => button.classList.toggle("actif", !button.dataset.categorie));
        afficher();
      });
      rafraichirIcones(grille);
    };
    afficher();
    document.querySelectorAll("[data-categorie]").forEach((button) => button.addEventListener("click", () => {
      categorieActive = button.dataset.categorie;
      boutiqueActive = "";
      document.querySelectorAll("[data-categorie]").forEach((element) => element.classList.toggle("actif", element === button));
      afficher();
      document.querySelector("#produits").scrollIntoView({ behavior: "smooth" });
    }));
    document.querySelector("#recherche-form").addEventListener("submit", (event) => {
      event.preventDefault();
      rechercheActive = document.querySelector("#recherche").value.trim();
      afficher();
      document.querySelector("#produits").scrollIntoView({ behavior: "smooth" });
    });
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
    coquille(`<main class="conteneur">
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
          <div class="carte" style="margin-top:18px"><div class="ligne"><span class="badge badge-succes">${icone("truck")}</span><div><strong>Livraison suivie par IKIGAI</strong><p class="muted petit" style="margin:4px 0 0">Frais de base : ${fcfa(produit.boutique?.frais_livraison_base)}</p></div></div></div>
        </div>
      </section>
      <section class="section"><div class="carte boutique-carte"><img class="boutique-logo" src="${escapeHtml(produit.boutique?.logo_url || images[0])}" alt=""><div><h2>${escapeHtml(produit.boutique?.nom)}</h2><p class="muted petit">${escapeHtml(produit.boutique?.description || produit.boutique?.adresse || "Marchand IKIGAI Market")}</p><a class="btn btn-secondaire" href="./index.html?boutique=${produit.boutique_id}#produits">Voir ses produits</a></div></div></section>
      <section class="section"><h2>Avis clients</h2><div class="pile">${avis.length ? avis.slice(0, 8).map((avisProduit) => `<article class="carte"><div class="ligne-entre"><strong>${escapeHtml(`${avisProduit.identites?.prenom || "Client"} ${avisProduit.identites?.nom?.[0] || ""}`.trim())}</strong><span class="note">${icone("star")} ${avisProduit.note}/5</span></div><p class="muted petit" style="margin:8px 0 0">${escapeHtml(avisProduit.commentaire || "A recommande ce produit.")}</p></article>`).join("") : '<p class="muted">Aucun avis pour le moment.</p>'}</div></section>
    </main>`);
    brancherFavoris(app, favoris);
    let quantite = 1;
    const afficherQuantite = () => { document.querySelector("#quantite").textContent = quantite; };
    document.querySelector("#moins").addEventListener("click", () => { quantite = Math.max(1, quantite - 1); afficherQuantite(); });
    document.querySelector("#plus").addEventListener("click", () => { quantite = Math.min(Math.max(produit.stock, 1), quantite + 1); afficherQuantite(); });
    document.querySelectorAll("[data-image]").forEach((button) => button.addEventListener("click", () => {
      document.querySelector("#image-principale").src = button.dataset.image;
      document.querySelectorAll("[data-image]").forEach((element) => element.classList.toggle("actif", element === button));
    }));
    document.querySelector("#ajouter").addEventListener("click", async (event) => {
      if (!etat.session) return demanderConnexion(location.pathname + location.search);
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
    const sousTotal = lignes.reduce((total, ligne) => total + ligne.produit.prix_effectif * ligne.quantite, 0);
    const boutiques = new Map(lignes.map((ligne) => [ligne.produit.boutique.id, ligne.produit.boutique]));
    const frais = [...boutiques.values()].reduce((total, boutique) => total + Number(boutique.frais_livraison_base || 0), 0);
    coquille(`<main class="conteneur"><div class="entete-page"><div><h1>Finaliser la commande</h1><p class="muted">Livraison et paiement</p></div></div><form id="checkout-form" class="deux-colonnes"><section class="pile"><div class="carte"><h2>Adresse de livraison</h2>${adresses.length ? `<div class="champ"><label>Adresse enregistree</label><select name="adresse_id" id="adresse-select">${adresses.map((adresse) => `<option value="${adresse.id}">${escapeHtml(adresse.libelle)} - ${escapeHtml(adresse.adresse)}</option>`).join("")}<option value="nouvelle">Utiliser une nouvelle adresse</option></select></div>` : '<input type="hidden" name="adresse_id" value="nouvelle">'}<div id="nouvelle-adresse" class="${adresses.length ? "masque" : ""}"><div class="grille-deux"><div class="champ"><label>Nom du destinataire</label><input name="destinataire_nom" value="${escapeHtml(`${profil.prenom || ""} ${profil.nom || ""}`.trim())}"></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" value="${escapeHtml(profil.telephone || "")}"></div></div><div class="champ"><label>Adresse</label><input name="adresse" placeholder="Quartier, rue, repere"></div><div class="grille-deux"><div class="champ"><label>Commune</label><input name="commune" placeholder="Cocody"></div><div class="champ"><label>Libelle</label><input name="libelle" value="Domicile"></div></div><div class="champ"><label>Indications</label><textarea name="indications" placeholder="Batiment, portail, point de repere..."></textarea></div></div></div><div class="carte"><h2>Paiement</h2><label class="case"><input type="radio" name="mode_paiement" value="A_LA_LIVRAISON" checked><span><strong>Paiement a la livraison</strong><br><span class="muted petit">Payez au moment de la remise de votre commande.</span></span></label><div class="bande-info bande-attention petit" style="margin-top:14px">Wave, Orange Money et carte seront proposes des que les comptes commercants seront configures.</div></div><div class="carte"><h2>Instructions</h2><div class="champ"><label>Note pour le marchand ou le livreur</label><textarea name="note" placeholder="Facultatif"></textarea></div></div></section><aside class="carte resume-sticky"><h2>Votre commande</h2><div class="pile">${lignes.map((ligne) => `<div class="ligne-entre petit"><span>${ligne.quantite} x ${escapeHtml(ligne.produit.nom)}</span><strong>${fcfa(ligne.produit.prix_effectif * ligne.quantite)}</strong></div>`).join("")}</div><hr class="separateur"><div class="ligne-entre"><span>Articles</span><strong>${fcfa(sousTotal)}</strong></div><div class="ligne-entre" style="margin-top:9px"><span>Livraison (${boutiques.size})</span><strong>${fcfa(frais)}</strong></div><hr class="separateur"><div class="ligne-entre"><strong>Total</strong><strong style="font-size:20px">${fcfa(sousTotal + frais)}</strong></div><button class="btn btn-primaire btn-bloc" style="margin-top:18px" id="confirmer">${icone("check")} Confirmer la commande</button><p class="muted petit" style="margin:12px 0 0">Le stock et le montant sont verifies une derniere fois avant validation.</p></aside></form></main>`, { actif: "panier" });
    const adresseSelect = document.querySelector("#adresse-select");
    adresseSelect?.addEventListener("change", () => document.querySelector("#nouvelle-adresse").classList.toggle("masque", adresseSelect.value !== "nouvelle"));
    document.querySelector("#checkout-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = document.querySelector("#confirmer");
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      let adresseId = valeurs.adresse_id;
      if (adresseId === "nouvelle") {
        if (!valeurs.destinataire_nom?.trim() || !valeurs.telephone?.trim() || !valeurs.adresse?.trim()) return toast("Nom, telephone et adresse sont requis.", true);
        boutonOccupe(button, true, "Enregistrement...");
        const { data, error } = await supabase.from("adresses_livraison").insert({
          identite_id: etat.session.user.id,
          destinataire_nom: valeurs.destinataire_nom.trim(),
          telephone: valeurs.telephone.trim(),
          adresse: valeurs.adresse.trim(),
          commune: valeurs.commune?.trim() || null,
          libelle: valeurs.libelle?.trim() || "Domicile",
          indications: valeurs.indications?.trim() || null,
          principale: adresses.length === 0,
        }).select("id").single();
        if (error) { boutonOccupe(button, false); return gererErreur(error); }
        adresseId = data.id;
      }
      boutonOccupe(button, true, "Validation...");
      const { data: achatId, error } = await supabase.rpc("rpc_valider_panier", {
        p_adresse_id: adresseId,
        p_mode_paiement: valeurs.mode_paiement,
        p_note: valeurs.note?.trim() || null,
      });
      if (error) { boutonOccupe(button, false); return gererErreur(error); }
      toast("Commande confirmee");
      location.href = `./compte.html?commande=${achatId}`;
    });
    rafraichirIcones(app);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Impossible de finaliser", messageErreur(error), '<a class="btn btn-secondaire" href="./panier.html">Retour au panier</a>')}</main>`, { actif: "panier" });
  }
}
