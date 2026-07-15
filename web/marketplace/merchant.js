import {
  boutonOccupe,
  escapeHtml,
  fcfa,
  formatDate,
  icone,
  imageProduit,
  messageErreur,
  rafraichirIcones,
  slugifier,
  supabase,
  televerserImage,
  toast,
} from "../assets/api.js";
import {
  app,
  badgeStatut,
  coquille,
  demanderConnexion,
  etat,
  gererErreur,
  vide,
} from "./shared.js";

let canalCommandes = null;

async function chargerAccesMarchands() {
  const { data, error } = await supabase
    .from("membres_organisation")
    .select("organisation_id, role, statut, organisations(id, nom, slug, type, logo_url)")
    .eq("identite_id", etat.session.user.id)
    .eq("statut", "ACTIF");
  if (error) throw error;
  return (data || [])
    .filter((lien) => ["MARCHAND", "RESTAURANT"].includes(lien.organisations?.type))
    .map((lien) => ({ ...lien.organisations, role: lien.role }));
}

function afficherOnboarding() {
  coquille(`<main class="conteneur conteneur-etroit"><div class="entete-page"><div><h1>Ouvrir une boutique</h1><p class="muted">Cree ton organisation marchande et commence ton catalogue.</p></div></div><form class="carte" id="onboarding-form"><div class="champ"><label>Nom commercial</label><input name="nom" required autocomplete="organization"></div><div class="champ"><label>Adresse web</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required><span class="champ-aide">Lettres minuscules, chiffres et tirets.</span></div><div class="champ"><label>Type d'activite</label><select name="type"><option value="MARCHAND">Commerce</option><option value="RESTAURANT">Restaurant</option></select></div><button class="btn btn-primaire btn-bloc" id="creer-espace">${icone("store")} Creer mon espace marchand</button></form></main>`, { mode: "gestion", espace: "Espace marchand" });
  const nom = document.querySelector('[name="nom"]');
  const slug = document.querySelector('[name="slug"]');
  let modifie = false;
  slug.addEventListener("input", () => { modifie = true; });
  nom.addEventListener("input", () => { if (!modifie) slug.value = slugifier(nom.value); });
  document.querySelector("#onboarding-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#creer-espace");
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    boutonOccupe(button, true, "Creation...");
    const organisation = await supabase.rpc("rpc_creer_organisation", { p_nom: valeurs.nom, p_slug: valeurs.slug, p_type: valeurs.type });
    if (organisation.error) { boutonOccupe(button, false); return gererErreur(organisation.error); }
    const boutique = await supabase.rpc("rpc_creer_boutique_marketplace", { p_organisation_id: organisation.data, p_nom: valeurs.nom, p_slug: valeurs.slug });
    boutonOccupe(button, false);
    if (boutique.error) return gererErreur(boutique.error);
    toast("Espace marchand cree");
    location.reload();
  });
  rafraichirIcones(app);
}

async function chargerEspace(organisation) {
  const boutiqueResultat = await supabase.from("boutiques").select("*").eq("organisation_id", organisation.id).maybeSingle();
  if (boutiqueResultat.error) throw boutiqueResultat.error;
  if (!boutiqueResultat.data) return { boutique: null };
  const boutique = boutiqueResultat.data;
  const [produits, commandes, categories, membres, integration] = await Promise.all([
    supabase.from("produits").select("id, boutique_id, categorie_id, nom, description, marque, prix, prix_barre, images, statut, cree_le, variantes_produit(id, nom, sku, actif, stocks(quantite, seuil_alerte))").eq("boutique_id", boutique.id).order("cree_le", { ascending: false }),
    supabase.from("commandes_marketplace").select("id, achat_id, reference, statut, sous_total, frais_livraison, total, note_client, vue_le, motif_annulation, cree_le, achats(reference, statut_paiement, mode_paiement, adresses_livraison(destinataire_nom, telephone, adresse, commune, indications)), lignes_commande_marketplace(id, nom_produit, nom_variante, image_url, prix_unitaire, quantite), historique_statuts_commande(ancien_statut, nouveau_statut, cree_le)").eq("boutique_id", boutique.id).order("cree_le", { ascending: false }).limit(200),
    supabase.from("categories_marketplace").select("id, nom").eq("actif", true).order("ordre"),
    supabase.from("membres_organisation").select("identite_id, role, statut, identites(prenom, nom, email)").eq("organisation_id", organisation.id).order("cree_le"),
    supabase.from("integrations_livraison").select("*").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const erreur = [produits.error, commandes.error, categories.error, membres.error, integration.error].find(Boolean);
  if (erreur) throw erreur;
  return {
    boutique,
    produits: produits.data || [],
    commandes: commandes.data || [],
    categories: categories.data || [],
    membres: membres.data || [],
    integration: integration.data,
  };
}

function stockProduit(produit) {
  return (produit.variantes_produit || []).reduce((total, variante) => {
    const stock = Array.isArray(variante.stocks) ? variante.stocks[0] : variante.stocks;
    return total + Number(stock?.quantite || 0);
  }, 0);
}

function prochaineAction(statut) {
  return {
    NOUVELLE: { statut: "CONFIRMEE", libelle: "Confirmer", icone: "check" },
    CONFIRMEE: { statut: "EN_PREPARATION", libelle: "Commencer", icone: "cooking-pot" },
    EN_PREPARATION: { statut: "PRETE", libelle: "Marquer prete", icone: "package-check" },
    PRETE: { statut: "EN_LIVRAISON", libelle: "Remise au livreur", icone: "truck" },
    EN_LIVRAISON: { statut: "LIVREE", libelle: "Marquer livree", icone: "badge-check" },
  }[statut];
}

export async function rendreMarchand() {
  if (!etat.session) return demanderConnexion("./marchand.html");
  coquille('<main class="conteneur"><div class="vide">Chargement de l\'espace marchand...</div></main>', { mode: "gestion", espace: "Espace marchand" });
  try {
    const organisations = await chargerAccesMarchands();
    if (!organisations.length) { afficherOnboarding(); return; }
    const organisationId = new URLSearchParams(location.search).get("organisation") || organisations[0].id;
    const organisation = organisations.find((element) => element.id === organisationId) || organisations[0];
    const donnees = await chargerEspace(organisation);
    if (!donnees.boutique) { afficherCreationBoutique(organisation); return; }
    afficherTableauMarchand(organisations, organisation, donnees);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Espace marchand indisponible", messageErreur(error))}</main>`, { mode: "gestion", espace: "Espace marchand" });
  }
}

function afficherCreationBoutique(organisation) {
  coquille(`<main class="conteneur conteneur-etroit"><div class="entete-page"><div><h1>Creer la boutique ${escapeHtml(organisation.nom)}</h1><p class="muted">L'organisation existe. Il reste a creer sa vitrine commerciale.</p></div></div><form class="carte" id="boutique-create"><div class="champ"><label>Nom de la boutique</label><input name="nom" value="${escapeHtml(organisation.nom)}" required></div><div class="champ"><label>Adresse web</label><input name="slug" value="${escapeHtml(organisation.slug)}" required></div><button class="btn btn-primaire btn-bloc">Creer la boutique</button></form></main>`, { mode: "gestion", espace: "Espace marchand" });
  document.querySelector("#boutique-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    const { error } = await supabase.rpc("rpc_creer_boutique_marketplace", { p_organisation_id: organisation.id, p_nom: valeurs.nom, p_slug: valeurs.slug });
    error ? gererErreur(error) : location.reload();
  });
}

function afficherTableauMarchand(organisations, organisation, donnees) {
  const gestionnaire = ["PROPRIETAIRE", "ADMIN", "GESTIONNAIRE"].includes(organisation.role);
  const administrateur = ["PROPRIETAIRE", "ADMIN"].includes(organisation.role);
  const totalCA = donnees.commandes.filter((commande) => commande.statut !== "ANNULEE").reduce((total, commande) => total + Number(commande.total || 0), 0);
  const nouvelles = donnees.commandes.filter((commande) => ["NOUVELLE", "CONFIRMEE", "EN_PREPARATION"].includes(commande.statut)).length;
  const stockFaible = donnees.produits.filter((produit) => stockProduit(produit) <= 5).length;
  const navigation = `<nav class="navigation-desktop"><a href="./marchand.html" class="actif">Gestion</a><a href="./index.html">Voir le site</a><a href="../identity/index.html">Equipe</a>${organisation.role === "PROPRIETAIRE" ? '<a href="./admin.html">Administration</a>' : ""}</nav>`;
  coquille(`<main class="conteneur"><div class="entete-page"><div><p class="muted petit">${escapeHtml(organisation.role)}</p><h1>${escapeHtml(donnees.boutique.nom)}</h1><p class="muted">Boutique ${escapeHtml(donnees.boutique.statut.toLowerCase())}</p></div><div class="entete-page-actions">${organisations.length > 1 ? `<select id="organisation-select" class="btn btn-secondaire">${organisations.map((element) => `<option value="${element.id}" ${element.id === organisation.id ? "selected" : ""}>${escapeHtml(element.nom)}</option>`).join("")}</select>` : ""}<a class="btn btn-secondaire" href="./index.html?boutique=${donnees.boutique.id}#produits">${icone("external-link")} Voir la boutique</a></div></div><div class="kpis"><div class="stat"><span class="muted petit">Commandes</span><strong>${donnees.commandes.length}</strong></div><div class="stat"><span class="muted petit">A traiter</span><strong>${nouvelles}</strong></div><div class="stat"><span class="muted petit">Stock faible</span><strong>${stockFaible}</strong></div><div class="stat"><span class="muted petit">Ventes</span><strong>${fcfa(totalCA)}</strong></div></div><div class="mise-en-page" style="margin-top:24px"><nav class="menu-lateral"><button class="actif" data-mtab="apercu">${icone("layout-dashboard")} Apercu</button><button data-mtab="commandes">${icone("package-check")} Commandes ${nouvelles ? `<span class="badge badge-attention">${nouvelles}</span>` : ""}</button>${gestionnaire ? `<button data-mtab="produits">${icone("package")} Produits</button>` : ""}${administrateur ? `<button data-mtab="equipe">${icone("users")} Equipe</button><button data-mtab="boutique">${icone("store")} Boutique</button><button data-mtab="livraison">${icone("truck")} Livraison</button>` : ""}</nav><section id="marchand-zone"></section></div></main><dialog class="dialogue" id="marchand-dialog"><div class="dialogue-entete"><h2 id="dialog-title"></h2><button class="dialogue-fermer" data-fermer aria-label="Fermer">${icone("x")}</button></div><div class="dialogue-corps" id="dialog-zone"></div></dialog>`, { mode: "gestion", espace: "Espace marchand", navigation });
  document.querySelector("#organisation-select")?.addEventListener("change", (event) => { location.href = `./marchand.html?organisation=${event.target.value}`; });
  document.querySelectorAll("[data-fermer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  const onglets = {
    apercu: () => afficherApercu(donnees, nouvelles, stockFaible),
    commandes: () => afficherCommandes(donnees),
    produits: () => afficherProduits(donnees),
    equipe: () => afficherEquipe(organisation, donnees),
    boutique: () => afficherBoutique(donnees),
    livraison: () => afficherLivraison(organisation, donnees),
  };
  document.querySelectorAll("[data-mtab]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-mtab]").forEach((element) => element.classList.toggle("actif", element === button));
    onglets[button.dataset.mtab]?.();
  }));
  afficherApercu(donnees, nouvelles, stockFaible);
  abonnerCommandes(donnees.boutique.id);
  rafraichirIcones(app);
}

function afficherApercu(donnees, nouvelles, stockFaible) {
  const zone = document.querySelector("#marchand-zone");
  const recentes = donnees.commandes.slice(0, 5);
  zone.innerHTML = `<div class="entete-page"><div><h2>Aujourd'hui</h2><p class="muted petit">Les priorites de la boutique</p></div></div><div class="grille-deux"><button class="carte carte-lien" data-raccourci="commandes" style="text-align:left"><span class="badge badge-attention">${nouvelles}</span><h3 style="margin-top:12px">Commandes a traiter</h3><p class="muted petit">Confirmer, preparer puis remettre a la livraison.</p></button><button class="carte carte-lien" data-raccourci="produits" style="text-align:left"><span class="badge ${stockFaible ? "badge-danger" : "badge-succes"}">${stockFaible}</span><h3 style="margin-top:12px">Alertes de stock</h3><p class="muted petit">Articles avec cinq unites ou moins.</p></button></div><section class="section"><h2>Dernieres commandes</h2>${recentes.length ? `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Total</th><th>Statut</th></tr></thead><tbody>${recentes.map((commande) => `<tr><td><strong>${escapeHtml(commande.reference)}</strong></td><td>${formatDate(commande.cree_le, true)}</td><td>${fcfa(commande.total)}</td><td>${badgeStatut(commande.statut)}</td></tr>`).join("")}</tbody></table></div>` : vide("package-open", "Aucune commande", "Les nouvelles commandes apparaitront ici en temps reel.")}</section>`;
  zone.querySelectorAll("[data-raccourci]").forEach((button) => button.addEventListener("click", () => document.querySelector(`[data-mtab="${button.dataset.raccourci}"]`)?.click()));
  rafraichirIcones(zone);
}

function afficherCommandes(donnees) {
  const zone = document.querySelector("#marchand-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Commandes</h2><p class="muted petit">Reception et preparation en temps reel</p></div><select id="filtre-commandes" class="btn btn-secondaire"><option value="">Tous les statuts</option><option>NOUVELLE</option><option>CONFIRMEE</option><option>EN_PREPARATION</option><option>PRETE</option><option>EN_LIVRAISON</option><option>LIVREE</option><option>ANNULEE</option></select></div><div id="commandes-liste"></div>`;
  const afficherListe = () => {
    const filtre = document.querySelector("#filtre-commandes").value;
    const commandes = donnees.commandes.filter((commande) => !filtre || commande.statut === filtre);
    document.querySelector("#commandes-liste").innerHTML = commandes.length ? `<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Client</th><th>Date</th><th>Total</th><th>Statut</th><th></th></tr></thead><tbody>${commandes.map((commande) => `<tr><td><strong>${escapeHtml(commande.reference)}</strong></td><td>${escapeHtml(commande.achats?.adresses_livraison?.destinataire_nom || "Client")}</td><td>${formatDate(commande.cree_le, true)}</td><td>${fcfa(commande.total)}</td><td>${badgeStatut(commande.statut)}</td><td><button class="btn btn-secondaire" data-commande="${commande.id}">${icone("eye")} Ouvrir</button></td></tr>`).join("")}</tbody></table></div>` : vide("package-open", "Aucune commande dans cette vue");
    document.querySelectorAll("[data-commande]").forEach((button) => button.addEventListener("click", () => ouvrirCommande(donnees, button.dataset.commande)));
    rafraichirIcones(document.querySelector("#commandes-liste"));
  };
  document.querySelector("#filtre-commandes").addEventListener("change", afficherListe);
  afficherListe();
}

function ouvrirCommande(donnees, commandeId) {
  const commande = donnees.commandes.find((element) => element.id === commandeId);
  const adresse = commande.achats?.adresses_livraison || {};
  const action = prochaineAction(commande.statut);
  document.querySelector("#dialog-title").textContent = commande.reference;
  document.querySelector("#dialog-zone").innerHTML = `<div class="ligne-entre"><div><p class="muted petit">${formatDate(commande.cree_le, true)}</p>${badgeStatut(commande.statut)}</div><strong>${fcfa(commande.total)}</strong></div><hr class="separateur"><div><h3>Articles</h3><div class="pile">${(commande.lignes_commande_marketplace || []).map((ligne) => `<div class="ligne"><img src="${escapeHtml(ligne.image_url || etat.configuration.hero_image_url)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px"><div style="flex:1"><strong>${escapeHtml(ligne.nom_produit)}</strong><p class="muted petit" style="margin:4px 0">${escapeHtml(ligne.nom_variante)} - ${ligne.quantite} x ${fcfa(ligne.prix_unitaire)}</p></div></div>`).join("")}</div></div><hr class="separateur"><div><h3>Livraison</h3><p class="muted petit">${escapeHtml(adresse.destinataire_nom || "Client")} - ${escapeHtml(adresse.telephone || "")}<br>${escapeHtml(adresse.adresse || "")} ${escapeHtml(adresse.commune || "")}<br>${escapeHtml(adresse.indications || "")}</p></div>${commande.note_client ? `<div class="bande-info"><strong>Note client</strong><p class="petit" style="margin:5px 0 0">${escapeHtml(commande.note_client)}</p></div>` : ""}<div class="ligne" style="margin-top:18px">${action ? `<button class="btn btn-primaire" id="action-commande">${icone(action.icone)} ${action.libelle}</button>` : ""}${["NOUVELLE", "CONFIRMEE", "EN_PREPARATION", "PRETE"].includes(commande.statut) ? `<button class="btn btn-danger" id="annuler-commande">${icone("x-circle")} Annuler</button>` : ""}</div>`;
  document.querySelector("#action-commande")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    boutonOccupe(button, true, "Mise a jour...");
    if (commande.statut === "PRETE" && donnees.integration?.actif) {
      const resultat = await supabase.functions.invoke("dispatch-livraison", { body: { commande_id: commande.id } });
      boutonOccupe(button, false);
      if (resultat.error || resultat.data?.error) return toast(messageErreur(resultat.error || { message: resultat.data.error }), true);
      toast("Commande transmise a IKIGAI Livraison");
      location.reload();
      return;
    }
    const { error } = await supabase.rpc("rpc_changer_statut_commande_marketplace", { p_commande_id: commande.id, p_nouveau_statut: action.statut, p_motif: null });
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Statut mis a jour");
    location.reload();
  });
  document.querySelector("#annuler-commande")?.addEventListener("click", async () => {
    const motif = prompt("Motif de l'annulation") || "Annulation par le marchand";
    const { error } = await supabase.rpc("rpc_changer_statut_commande_marketplace", { p_commande_id: commande.id, p_nouveau_statut: "ANNULEE", p_motif: motif });
    if (error) return gererErreur(error);
    toast("Commande annulee et stock restitue");
    location.reload();
  });
  rafraichirIcones(document.querySelector("#dialog-zone"));
  document.querySelector("#marchand-dialog").showModal();
}

function afficherProduits(donnees) {
  const zone = document.querySelector("#marchand-zone");
  const publication = donnees.boutique.statut === "BROUILLON"
    ? `<div class="bande-info ligne-entre" style="margin-bottom:17px"><div><strong>Boutique en brouillon</strong><p class="petit" style="margin:5px 0 0">Les produits ne sont pas encore visibles dans la marketplace.</p></div><button class="btn btn-primaire" id="publier-boutique">${icone("globe-2")} Publier</button></div>`
    : "";
  zone.innerHTML = `<div class="entete-page"><div><h2>Catalogue</h2><p class="muted petit">Produits, photos, prix et stock</p></div><button class="btn btn-primaire" id="nouveau-produit">${icone("plus")} Nouveau produit</button></div>${publication}${donnees.produits.length ? `<div class="table-wrap"><table><thead><tr><th>Produit</th><th>Prix</th><th>Stock</th><th>Statut</th><th></th></tr></thead><tbody>${donnees.produits.map((produit) => `<tr><td><div class="cellule-produit"><img src="${escapeHtml(imageProduit(produit))}" alt=""><div><strong>${escapeHtml(produit.nom)}</strong><p class="muted petit" style="margin:3px 0">${escapeHtml(produit.marque || "")}</p></div></div></td><td>${fcfa(produit.prix)}</td><td>${stockProduit(produit)}</td><td>${badgeStatut(produit.statut)}</td><td><button class="btn btn-secondaire" data-editer-produit="${produit.id}">${icone("pencil")} Modifier</button></td></tr>`).join("")}</tbody></table></div>` : vide("package", "Aucun produit", "Ajoute le premier article de la boutique.")}`;
  zone.querySelector("#publier-boutique")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    boutonOccupe(button, true, "Publication...");
    const { error } = await supabase.from("boutiques").update({ statut: "PUBLIEE" }).eq("id", donnees.boutique.id);
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Boutique publiee");
    location.reload();
  });
  zone.querySelector("#nouveau-produit").addEventListener("click", () => ouvrirProduit(donnees, null));
  zone.querySelectorAll("[data-editer-produit]").forEach((button) => button.addEventListener("click", () => ouvrirProduit(donnees, donnees.produits.find((produit) => produit.id === button.dataset.editerProduit))));
  rafraichirIcones(zone);
}

function ouvrirProduit(donnees, produit) {
  const stock = produit ? stockProduit(produit) : 0;
  document.querySelector("#dialog-title").textContent = produit ? "Modifier le produit" : "Nouveau produit";
  document.querySelector("#dialog-zone").innerHTML = `<form id="produit-form"><div class="champ"><label>Nom</label><input name="nom" minlength="2" maxlength="160" value="${escapeHtml(produit?.nom)}" required><span class="champ-aide">2 a 160 caracteres.</span></div><div class="grille-deux"><div class="champ"><label>Marque</label><input name="marque" maxlength="100" value="${escapeHtml(produit?.marque)}"></div><div class="champ"><label>Categorie</label><select name="categorie_id"><option value="">Sans categorie</option>${donnees.categories.map((categorie) => `<option value="${categorie.id}" ${categorie.id === produit?.categorie_id ? "selected" : ""}>${escapeHtml(categorie.nom)}</option>`).join("")}</select></div></div><div class="champ"><label>Description</label><textarea name="description" maxlength="5000">${escapeHtml(produit?.description)}</textarea><span class="champ-aide">5 000 caracteres maximum.</span></div><div class="grille-deux"><div class="champ"><label>Prix (FCFA)</label><input name="prix" type="number" min="1" max="2000000000" step="1" value="${produit?.prix ?? ""}" required></div><div class="champ"><label>Stock</label><input name="stock" type="number" min="0" max="1000000" step="1" value="${stock}" required></div></div><div class="champ"><label>Statut</label><select name="statut"><option value="ACTIF" ${produit?.statut === "ACTIF" ? "selected" : ""}>Actif</option><option value="BROUILLON" ${produit?.statut === "BROUILLON" ? "selected" : ""}>Brouillon</option><option value="EPUISE" ${produit?.statut === "EPUISE" ? "selected" : ""}>Epuise</option><option value="ARCHIVE" ${produit?.statut === "ARCHIVE" ? "selected" : ""}>Archive</option></select></div><div class="champ"><label>Photos</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="champ-aide">6 images maximum, 5 Mo par image. Une photo est obligatoire pour publier.</span></div>${produit?.images?.length ? `<div class="ligne" style="overflow-x:auto">${produit.images.map((image) => `<img src="${escapeHtml(image)}" alt="" style="width:70px;height:70px;object-fit:cover;border-radius:6px">`).join("")}</div>` : ""}<button class="btn btn-primaire btn-bloc" id="sauver-produit" style="margin-top:17px">${icone("save")} Enregistrer le produit</button></form>`;
  document.querySelector("#produit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#sauver-produit");
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    try {
      const fichiers = [...form.elements.photos.files];
      if (fichiers.length > 6) throw new Error("Un produit est limite a 6 images.");
      if (["ACTIF", "EPUISE"].includes(valeurs.statut) && !valeurs.categorie_id) throw new Error("Choisis une categorie avant de publier.");
      if (["ACTIF", "EPUISE"].includes(valeurs.statut) && !fichiers.length && !produit?.images?.length) throw new Error("Ajoute au moins une photo avant de publier.");
      const images = fichiers.length
        ? await Promise.all(fichiers.map((fichier) => televerserImage(fichier, `${donnees.boutique.id}/produits`)))
        : (produit?.images || []);
      const publicationAutomatique = !produit && valeurs.statut === "ACTIF" && donnees.boutique.statut === "BROUILLON";
      const { error } = await supabase.rpc("rpc_enregistrer_produit_marketplace", {
        p_boutique_id: donnees.boutique.id,
        p_nom: valeurs.nom,
        p_prix: Number(valeurs.prix),
        p_stock: Number(valeurs.stock),
        p_produit_id: produit?.id || null,
        p_categorie_id: valeurs.categorie_id || null,
        p_description: valeurs.description || null,
        p_marque: valeurs.marque || null,
        p_images: images,
        p_statut: valeurs.statut,
      });
      if (error) throw error;
      toast(publicationAutomatique ? "Produit enregistre et boutique publiee" : "Produit enregistre");
      location.reload();
    } catch (error) {
      boutonOccupe(button, false);
      gererErreur(error);
    }
  });
  rafraichirIcones(document.querySelector("#dialog-zone"));
  document.querySelector("#marchand-dialog").showModal();
}

function afficherEquipe(organisation, donnees) {
  const zone = document.querySelector("#marchand-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Equipe</h2><p class="muted petit">Les agents peuvent traiter les commandes sans modifier la boutique.</p></div><button class="btn btn-primaire" id="inviter-membre">${icone("user-plus")} Inviter</button></div><div class="table-wrap"><table><thead><tr><th>Membre</th><th>Email</th><th>Role</th><th>Statut</th></tr></thead><tbody>${donnees.membres.map((membre) => `<tr><td><strong>${escapeHtml(`${membre.identites?.prenom || ""} ${membre.identites?.nom || ""}`.trim() || "Invitation")}</strong></td><td>${escapeHtml(membre.identites?.email || "")}</td><td>${escapeHtml(membre.role)}</td><td>${badgeStatut(membre.statut)}</td></tr>`).join("")}</tbody></table></div><div id="invitation-resultat" style="margin-top:15px"></div>`;
  zone.querySelector("#inviter-membre").addEventListener("click", () => {
    document.querySelector("#dialog-title").textContent = "Inviter un membre";
    document.querySelector("#dialog-zone").innerHTML = `<form id="invite-form"><div class="champ"><label>Email</label><input name="email" type="email" required></div><div class="champ"><label>Role</label><select name="role"><option value="AGENT">Agent commandes</option><option value="GESTIONNAIRE">Gestionnaire</option><option value="ADMIN">Administrateur</option><option value="MEMBRE">Membre</option></select></div><button class="btn btn-primaire btn-bloc">Creer l'invitation</button></form>`;
    document.querySelector("#invite-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      const { data, error } = await supabase.rpc("rpc_inviter_membre", { p_organisation_id: organisation.id, p_email: valeurs.email, p_role: valeurs.role });
      if (error) return gererErreur(error);
      const lien = `${location.origin}${location.pathname.replace(/marketplace\/marchand\.html$/, "identity/index.html")}?invitation=${data.token}`;
      await navigator.clipboard.writeText(lien).catch(() => null);
      document.querySelector("#marchand-dialog").close();
      zone.querySelector("#invitation-resultat").innerHTML = `<div class="bande-info"><strong>Invitation creee</strong><p class="petit" style="word-break:break-all;margin:6px 0">${escapeHtml(lien)}</p><p class="petit" style="margin:0">Le lien a ete copie. Il reste valable 7 jours.</p></div>`;
      toast("Lien d'invitation copie");
    });
    document.querySelector("#marchand-dialog").showModal();
  });
  rafraichirIcones(zone);
}

function afficherBoutique(donnees) {
  const zone = document.querySelector("#marchand-zone");
  const boutique = donnees.boutique;
  zone.innerHTML = `<form class="carte" id="boutique-form"><h2>Personnaliser la boutique</h2><div class="champ"><label>Nom</label><input name="nom" minlength="2" maxlength="120" value="${escapeHtml(boutique.nom)}" required></div><div class="champ"><label>Description</label><textarea name="description" maxlength="2000">${escapeHtml(boutique.description)}</textarea></div><div class="grille-deux"><div class="champ"><label>Telephone</label><input name="telephone" type="tel" maxlength="30" value="${escapeHtml(boutique.telephone)}"></div><div class="champ"><label>WhatsApp</label><input name="whatsapp" type="tel" maxlength="30" value="${escapeHtml(boutique.whatsapp)}"></div></div><div class="champ"><label>Email de contact</label><input name="email_contact" type="email" maxlength="254" value="${escapeHtml(boutique.email_contact)}"></div><div class="champ"><label>Adresse</label><input name="adresse" maxlength="500" value="${escapeHtml(boutique.adresse)}"></div><div class="grille-deux"><div class="champ"><label>Frais de livraison de base</label><input name="frais_livraison_base" type="number" min="0" max="5000000" value="${boutique.frais_livraison_base}"></div><div class="champ"><label>Delai de preparation (minutes)</label><input name="delai_preparation_minutes" type="number" min="0" max="10080" value="${boutique.delai_preparation_minutes || 60}"></div></div><div class="champ"><label>Publication</label><select name="statut"><option value="BROUILLON" ${boutique.statut === "BROUILLON" ? "selected" : ""}>Brouillon</option><option value="PUBLIEE" ${boutique.statut === "PUBLIEE" ? "selected" : ""}>Publiee</option></select></div><div class="grille-deux"><div class="champ"><label>Logo</label><input name="logo" type="file" accept="image/jpeg,image/png,image/webp">${boutique.logo_url ? `<img src="${escapeHtml(boutique.logo_url)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:6px">` : ""}</div><div class="champ"><label>Banniere</label><input name="banniere" type="file" accept="image/jpeg,image/png,image/webp">${boutique.banniere_url ? `<img src="${escapeHtml(boutique.banniere_url)}" alt="" style="width:160px;height:90px;object-fit:cover;border-radius:6px">` : ""}</div></div><button class="btn btn-primaire" id="sauver-boutique">${icone("save")} Enregistrer</button></form>`;
  zone.querySelector("#boutique-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#sauver-boutique");
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    try {
      const logo = form.elements.logo.files[0] ? await televerserImage(form.elements.logo.files[0], `${boutique.id}/boutique`) : boutique.logo_url;
      const banniere = form.elements.banniere.files[0] ? await televerserImage(form.elements.banniere.files[0], `${boutique.id}/boutique`) : boutique.banniere_url;
      const { error } = await supabase.from("boutiques").update({
        nom: valeurs.nom,
        description: valeurs.description || null,
        telephone: valeurs.telephone || null,
        whatsapp: valeurs.whatsapp || null,
        email_contact: valeurs.email_contact || null,
        adresse: valeurs.adresse || null,
        frais_livraison_base: Number(valeurs.frais_livraison_base || 0),
        delai_preparation_minutes: Number(valeurs.delai_preparation_minutes || 0),
        statut: valeurs.statut,
        logo_url: logo,
        banniere_url: banniere,
      }).eq("id", boutique.id);
      if (error) throw error;
      toast("Boutique mise a jour");
      location.reload();
    } catch (error) { boutonOccupe(button, false); gererErreur(error); }
  });
  rafraichirIcones(zone);
}

function afficherLivraison(organisation, donnees) {
  const zone = document.querySelector("#marchand-zone");
  const integration = donnees.integration || {};
  zone.innerHTML = `<div class="bande-info"><strong>Deux modes disponibles</strong><p class="petit" style="margin:5px 0 0">Sans integration, l'equipe peut remettre manuellement une commande a un livreur. Avec Ikigai Livraison, la mission est envoyee automatiquement quand la commande est prete.</p></div><form class="carte" id="livraison-form" style="margin-top:15px"><h2>Connexion Ikigai Livraison</h2><div class="champ"><label>Code entreprise Livraison</label><input name="code_entreprise_livraison" value="${escapeHtml(integration.code_entreprise_livraison)}" placeholder="IKLIV"></div><div class="champ"><label>Identifiant client pro dans Livraison</label><input name="compte_pro_externe_id" value="${escapeHtml(integration.compte_pro_externe_id)}" placeholder="UUID"></div><label class="case"><input name="actif" type="checkbox" ${integration.actif ? "checked" : ""}> Activer l'envoi automatique depuis la commande</label><button class="btn btn-primaire" style="margin-top:16px">${icone("link")} Enregistrer la connexion</button></form>`;
  zone.querySelector("#livraison-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    if (!valeurs.code_entreprise_livraison) return toast("Le code entreprise est requis.", true);
    const { error } = await supabase.from("integrations_livraison").upsert({
      organisation_id: organisation.id,
      code_entreprise_livraison: valeurs.code_entreprise_livraison,
      compte_pro_externe_id: valeurs.compte_pro_externe_id || null,
      actif: new FormData(form).has("actif"),
    });
    error ? gererErreur(error) : toast("Connexion Livraison enregistree");
  });
  rafraichirIcones(zone);
}

function abonnerCommandes(boutiqueId) {
  if (canalCommandes) supabase.removeChannel(canalCommandes);
  canalCommandes = supabase
    .channel(`commandes-boutique-${boutiqueId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "commandes_marketplace", filter: `boutique_id=eq.${boutiqueId}` }, (message) => {
      toast(`Nouvelle commande ${message.new.reference}`);
      window.setTimeout(() => location.reload(), 1200);
    })
    .subscribe();
}
