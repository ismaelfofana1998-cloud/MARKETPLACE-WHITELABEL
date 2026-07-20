import {
  boutonOccupe,
  chargerZonesIkms,
  escapeHtml,
  fcfa,
  formatDate,
  icone,
  imageProduit,
  memoriserOnglet,
  messageErreur,
  ongletDepuisUrl,
  rafraichirIcones,
  slugifier,
  supabase,
  televerserImage,
  toast,
} from "../assets/api.js?v=18";
import {
  app,
  badgeStatut,
  coquille,
  demanderConnexion,
  etat,
  gererErreur,
  squelettePage,
  vide,
} from "./shared.js?v=21";
import {
  rendreCodesMission,
  rendreComparaisonFrais,
  rendreParcoursLivraison,
} from "./logistics.js?v=18";

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

async function verifierAccesAdministration() {
  const { data, error } = await supabase
    .from("administrateurs_plateforme")
    .select("role")
    .eq("identite_id", etat.session.user.id)
    .eq("actif", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function normaliserTelephoneRamassage(valeur) {
  let telephone = String(valeur || "").replace(/\D/g, "");
  if (telephone.length === 13 && telephone.startsWith("225")) telephone = telephone.slice(3);
  return telephone;
}

function champsRamassage(catalogueZones, valeurs = {}) {
  const options = (catalogueZones.zones || [])
    .map((zone) => `<option value="${escapeHtml(zone.code)}" ${zone.code === valeurs.zone_depart ? "selected" : ""}>${escapeHtml(zone.nom || zone.code)}</option>`)
    .join("");
  return `<div class="champ"><label>Zone de ramassage habituelle</label>${options ? `<select name="zone_depart" required><option value="">Choisir une zone</option>${options}</select>` : `<input name="zone_depart" value="${escapeHtml(valeurs.zone_depart)}" placeholder="COCODY" required>`}<span class="champ-aide">Cette zone IKMS servira au calcul de la livraison et restera modifiable.</span></div><div class="grille-deux"><div class="champ"><label>Telephone de ramassage</label><input name="expediteur_tel" type="tel" value="${escapeHtml(valeurs.expediteur_tel)}" placeholder="0700000000" required></div><div class="champ"><label>Adresse de ramassage</label><input name="expediteur_adresse" value="${escapeHtml(valeurs.expediteur_adresse)}" placeholder="Quartier, rue, repere" required></div></div>`;
}

async function initialiserRamassageBoutique(boutiqueId, valeurs) {
  return supabase.rpc("rpc_configurer_integration_ikms_boutique", {
    p_boutique_id: boutiqueId,
    p_zone_depart: String(valeurs.zone_depart || "").trim().toUpperCase(),
    p_expediteur_nom: String(valeurs.nom || "").trim(),
    p_expediteur_tel: normaliserTelephoneRamassage(valeurs.expediteur_tel),
    p_expediteur_adresse: String(valeurs.expediteur_adresse || "").trim(),
    p_mode_paiement: "SANS_PAIEMENT",
    p_api_key: null,
    p_actif: false,
  });
}

async function afficherOnboarding() {
  const catalogueZones = await chargerZonesIkms(etat.configuration);
  coquille(`<main class="conteneur conteneur-etroit"><div class="entete-page"><div><h1>Ouvrir une boutique</h1><p class="muted">Cree ton organisation marchande et commence ton catalogue.</p></div></div><form class="carte" id="onboarding-form"><div class="champ"><label>Nom commercial</label><input name="nom" required autocomplete="organization"></div><div class="champ"><label>Adresse web</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required><span class="champ-aide">Lettres minuscules, chiffres et tirets.</span></div><div class="champ"><label>Type d'activite</label><select name="type"><option value="MARCHAND">Commerce</option><option value="RESTAURANT">Restaurant</option></select></div>${champsRamassage(catalogueZones)}<button class="btn btn-primaire btn-bloc" id="creer-espace">${icone("store")} Creer mon espace marchand</button></form></main>`, { mode: "gestion", espace: "Espace marchand" });
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
    if (boutique.error) { boutonOccupe(button, false); return gererErreur(boutique.error); }
    const ramassage = await initialiserRamassageBoutique(boutique.data, valeurs);
    boutonOccupe(button, false);
    if (ramassage.error) {
      toast("Boutique creee. Completez la zone de ramassage dans Livraison.", true);
      location.href = "./marchand.html#livraison";
      return;
    }
    toast("Espace marchand cree");
    location.href = "./marchand.html#livraison";
  });
  rafraichirIcones(app);
}

async function chargerEspace(organisation, boutiqueId = null) {
  const boutiqueResultat = await supabase.from("boutiques").select("*").eq("organisation_id", organisation.id).order("cree_le");
  if (boutiqueResultat.error) throw boutiqueResultat.error;
  const boutiques = boutiqueResultat.data || [];
  if (!boutiques.length) return { boutique: null, boutiques: [] };
  const boutique = boutiques.find((element) => element.id === boutiqueId) || boutiques[0];
  await supabase.functions.invoke("sync-livraisons", { body: {} }).catch(() => null);
  const [produits, commandes, categories, categoriesBoutique, membres, integration, offre, configurationSite, domaines, wave] = await Promise.all([
    supabase.from("produits").select("id, boutique_id, categorie_id, categorie_boutique_id, nom, description, marque, prix, prix_barre, images, statut, cree_le, variantes_produit(id, nom, sku, actif, stocks(quantite, seuil_alerte))").eq("boutique_id", boutique.id).order("cree_le", { ascending: false }),
    supabase.from("commandes_marketplace").select("id, achat_id, reference, statut, sous_total, frais_livraison, frais_livraison_a_confirmer, total, note_client, vue_le, motif_annulation, cree_le, achats(reference, statut_paiement, mode_paiement, adresses_livraison(destinataire_nom, telephone, adresse, commune, indications, code_zone)), lignes_commande_marketplace(id, nom_produit, nom_variante, image_url, prix_unitaire, quantite), missions_logistiques(statut, statut_ikms, commande_livraison_externe_id, code_ramassage, code_livraison, montant_livraison, derniere_synchronisation, derniere_erreur))").eq("boutique_id", boutique.id).order("cree_le", { ascending: false }).limit(200),
    supabase.from("categories_marketplace").select("id, nom").eq("actif", true).order("ordre"),
    supabase.from("categories_boutique").select("id, boutique_id, nom, slug, description, image_url, ordre, actif").eq("boutique_id", boutique.id).order("ordre").order("nom"),
    supabase.from("membres_organisation").select("identite_id, role, statut, identites(prenom, nom, email)").eq("organisation_id", organisation.id).order("cree_le"),
    supabase.from("integrations_ikms_boutique").select("boutique_id, zone_depart, expediteur_nom, expediteur_tel, expediteur_adresse, mode_paiement, cle_api_configuree, actif, derniere_verification, derniere_erreur, modifie_le").eq("boutique_id", boutique.id).maybeSingle(),
    supabase.from("offres_organisations").select("offre, white_label_actif, domaines_personnalises, max_etablissements, active").eq("organisation_id", organisation.id).maybeSingle(),
    supabase.from("configurations_boutique").select("*").eq("boutique_id", boutique.id).maybeSingle(),
    supabase.from("domaines_boutique").select("id, boutique_id, domaine, statut, principal, jeton_verification, verifie_le").eq("boutique_id", boutique.id).order("principal", { ascending: false }),
    supabase.from("configurations_wave_organisation").select("organisation_id, actif, api_key_configuree, signing_secret_configure, api_key_suffixe, modifie_le").eq("organisation_id", organisation.id).maybeSingle(),
  ]);
  const erreur = [produits.error, commandes.error, categories.error, categoriesBoutique.error, membres.error, integration.error, offre.error, configurationSite.error, domaines.error, wave.error].find(Boolean);
  if (erreur) throw erreur;
  return {
    boutique,
    boutiques,
    produits: produits.data || [],
    commandes: commandes.data || [],
    categories: categories.data || [],
    categoriesBoutique: categoriesBoutique.data || [],
    membres: membres.data || [],
    integration: integration.data,
    offre: offre.data || { offre: "STANDARD", max_etablissements: 1 },
    configurationSite: configurationSite.data,
    domaines: domaines.data || [],
    wave: wave.data || {},
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
    CONFIRMEE: { statut: "EN_PREPARATION", libelle: "Preparer", icone: "cooking-pot" },
    EN_PREPARATION: { statut: "PRETE", libelle: "Prete pour livraison", icone: "package-check" },
    PRETE: { statut: "EN_LIVRAISON", libelle: "Transmettre au livreur", icone: "truck" },
  }[statut];
}

function demanderMotifAnnulation(source = "marchand") {
  const motif = prompt(`Motif de l'annulation (${source})`);
  if (motif === null) return null;
  const nettoye = motif.trim();
  if (!nettoye) {
    toast("Annulation interrompue : indique un motif.", true);
    return null;
  }
  return nettoye;
}

async function executerActionCommande(donnees, commande, action, button) {
  boutonOccupe(button, true, "Mise a jour...");
  if (commande.statut === "PRETE") {
    if (!donnees.integration?.actif || !donnees.integration?.cle_api_configuree) {
      boutonOccupe(button, false);
      return toast("Configure et active d'abord le compte client pro IKMS.", true);
    }
    const resultat = await supabase.functions.invoke("dispatch-livraison", { body: { commande_id: commande.id } });
    boutonOccupe(button, false);
    if (resultat.error || resultat.data?.error) {
      return toast(messageErreur(resultat.error || { message: resultat.data.error }), true);
    }
    toast("Commande transmise a IKIGAI Livraison");
    location.reload();
    return;
  }
  const { error } = await supabase.rpc("rpc_changer_statut_commande_marketplace", {
    p_commande_id: commande.id,
    p_nouveau_statut: action.statut,
    p_motif: null,
  });
  boutonOccupe(button, false);
  if (error) return gererErreur(error);
  await supabase.functions.invoke("sync-livraisons", { body: { commande_id: commande.id, notifications_uniquement: true } });
  toast("Statut mis a jour");
  location.reload();
}

async function annulerCommandeMarchand(commande, button) {
  const motif = demanderMotifAnnulation("marchand");
  if (!motif) return;
  boutonOccupe(button, true, "Annulation...");
  const { error } = await supabase.rpc("rpc_changer_statut_commande_marketplace", {
    p_commande_id: commande.id,
    p_nouveau_statut: "ANNULEE",
    p_motif: motif,
  });
  boutonOccupe(button, false);
  if (error) return gererErreur(error);
  await supabase.functions.invoke("sync-livraisons", { body: { commande_id: commande.id, notifications_uniquement: true } });
  toast("Commande annulee et stock restitue");
  location.reload();
}

export async function rendreMarchand() {
  if (!etat.session) return demanderConnexion();
  coquille(squelettePage("contenu"), { mode: "gestion", espace: "Espace marchand" });
  try {
    const [organisations, adminPlateforme] = await Promise.all([
      chargerAccesMarchands(),
      verifierAccesAdministration(),
    ]);
    if (!organisations.length) { await afficherOnboarding(); return; }
    const organisationId = new URLSearchParams(location.search).get("organisation") || organisations[0].id;
    const organisation = organisations.find((element) => element.id === organisationId) || organisations[0];
    const boutiqueId = new URLSearchParams(location.search).get("boutique");
    const donnees = await chargerEspace(organisation, boutiqueId);
    if (!donnees.boutique) { await afficherCreationBoutique(organisation); return; }
    afficherTableauMarchand(organisations, organisation, donnees, adminPlateforme);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Espace marchand indisponible", messageErreur(error))}</main>`, { mode: "gestion", espace: "Espace marchand" });
  }
}

async function afficherCreationBoutique(organisation) {
  const catalogueZones = await chargerZonesIkms(etat.configuration);
  coquille(`<main class="conteneur conteneur-etroit"><div class="entete-page"><div><h1>Creer la boutique ${escapeHtml(organisation.nom)}</h1><p class="muted">L'organisation existe. Il reste a creer sa vitrine commerciale.</p></div></div><form class="carte" id="boutique-create"><div class="champ"><label>Nom de la boutique</label><input name="nom" value="${escapeHtml(organisation.nom)}" required></div><div class="champ"><label>Adresse web</label><input name="slug" value="${escapeHtml(organisation.slug)}" required></div>${champsRamassage(catalogueZones)}<button class="btn btn-primaire btn-bloc">Creer la boutique</button></form></main>`, { mode: "gestion", espace: "Espace marchand" });
  document.querySelector("#boutique-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    const boutique = await supabase.rpc("rpc_creer_boutique_marketplace", { p_organisation_id: organisation.id, p_nom: valeurs.nom, p_slug: valeurs.slug });
    if (boutique.error) return gererErreur(boutique.error);
    const ramassage = await initialiserRamassageBoutique(boutique.data, valeurs);
    if (ramassage.error) toast("Boutique creee. Completez la zone dans Livraison.", true);
    location.href = "./marchand.html#livraison";
  });
}

function afficherTableauMarchand(organisations, organisation, donnees, adminPlateforme) {
  const gestionnaire = ["PROPRIETAIRE", "ADMIN", "GESTIONNAIRE"].includes(organisation.role);
  const administrateur = ["PROPRIETAIRE", "ADMIN"].includes(organisation.role);
  const totalCA = donnees.commandes.filter((commande) => commande.statut !== "ANNULEE").reduce((total, commande) => total + Number(commande.total || 0), 0);
  const nouvelles = donnees.commandes.filter((commande) => ["NOUVELLE", "CONFIRMEE", "EN_PREPARATION"].includes(commande.statut)).length;
  const stockFaible = donnees.produits.filter((produit) => stockProduit(produit) <= 5).length;
  const siteDedie = donnees.offre.offre === "WHITE_LABEL" && donnees.offre.white_label_actif;
  const urlPublique = siteDedie && donnees.boutique.mode_vitrine === "WHITE_LABEL"
    ? `./index.html?site=${encodeURIComponent(donnees.boutique.slug)}`
    : `./index.html?boutique=${donnees.boutique.id}#produits`;
  const peutAjouter = administrateur && donnees.boutiques.length < Number(donnees.offre.max_etablissements || 1);
  const navigation = `<nav class="navigation-desktop"><a href="./marchand.html#apercu" class="actif">Gestion</a><a href="${urlPublique}">Voir le site</a><a href="../identity/index.html#equipe">Equipe</a>${adminPlateforme ? '<a href="./admin.html#tableau">Administration</a>' : ""}</nav>`;
  coquille(`<main class="conteneur"><div class="entete-page"><div><p class="muted petit">${escapeHtml(organisation.role)} · ${siteDedie ? "Site dédié" : "Marketplace"}</p><h1>${escapeHtml(donnees.boutique.nom)}</h1><p class="muted">Établissement ${escapeHtml(donnees.boutique.statut.toLowerCase())}</p></div><div class="entete-page-actions">${organisations.length > 1 ? `<select id="organisation-select" class="btn btn-secondaire">${organisations.map((element) => `<option value="${element.id}" ${element.id === organisation.id ? "selected" : ""}>${escapeHtml(element.nom)}</option>`).join("")}</select>` : ""}<select id="boutique-select" class="btn btn-secondaire" aria-label="Établissement">${donnees.boutiques.map((element) => `<option value="${element.id}" ${element.id === donnees.boutique.id ? "selected" : ""}>${escapeHtml(element.nom)}</option>`).join("")}</select>${peutAjouter ? `<button class="btn btn-secondaire" id="ajouter-établissement">${icone("plus")} Établissement</button>` : ""}<a class="btn btn-secondaire" href="${urlPublique}">${icone("external-link")} Voir le site</a></div></div><div class="kpis"><div class="stat"><span class="muted petit">Commandes</span><strong>${donnees.commandes.length}</strong></div><div class="stat"><span class="muted petit">A traiter</span><strong>${nouvelles}</strong></div><div class="stat"><span class="muted petit">Stock faible</span><strong>${stockFaible}</strong></div><div class="stat"><span class="muted petit">Ventes</span><strong>${fcfa(totalCA)}</strong></div></div><div class="mise-en-page" style="margin-top:24px"><nav class="menu-lateral"><button class="actif" data-mtab="apercu">${icone("layout-dashboard")} Apercu</button><button data-mtab="commandes">${icone("package-check")} Commandes ${nouvelles ? `<span class="badge badge-attention">${nouvelles}</span>` : ""}</button>${gestionnaire ? `<button data-mtab="produits">${icone("package")} Produits</button>` : ""}${administrateur ? `<button data-mtab="equipe">${icone("users")} Equipe</button><button data-mtab="boutique">${icone("store")} Établissement</button>${siteDedie ? `<button data-mtab="site-dedie">${icone("palette")} Site dédié</button>` : ""}<button data-mtab="livraison">${icone("truck")} Livraison</button><button data-mtab="paiements">${icone("wallet-cards")} Paiements</button>` : ""}</nav><section id="marchand-zone"></section></div></main><dialog class="dialogue" id="marchand-dialog"><div class="dialogue-entete"><h2 id="dialog-title"></h2><button class="dialogue-fermer" data-fermer aria-label="Fermer">${icone("x")}</button></div><div class="dialogue-corps" id="dialog-zone"></div></dialog>`, { mode: "gestion", espace: "Espace marchand", navigation });
  document.querySelector("#organisation-select")?.addEventListener("change", (event) => { location.href = `./marchand.html?organisation=${event.target.value}${location.hash}`; });
  document.querySelector("#boutique-select")?.addEventListener("change", (event) => { location.href = `./marchand.html?organisation=${organisation.id}&boutique=${event.target.value}${location.hash}`; });
  document.querySelector("#ajouter-établissement")?.addEventListener("click", () => ouvrirNouvelEtablissement(organisation));
  document.querySelectorAll("[data-fermer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  const onglets = {
    apercu: () => afficherApercu(donnees, nouvelles, stockFaible),
    commandes: () => afficherCommandes(donnees),
    produits: () => afficherProduits(donnees),
    equipe: () => afficherEquipe(organisation, donnees),
    boutique: () => afficherBoutique(donnees),
    "site-dedie": () => afficherSiteDedie(donnees),
    livraison: () => afficherLivraison(donnees),
    paiements: () => afficherPaiements(organisation, donnees),
  };
  const afficherOnglet = (nom, memoriser = false) => {
    const onglet = onglets[nom] && document.querySelector(`[data-mtab="${nom}"]`) ? nom : "apercu";
    if (memoriser) memoriserOnglet(onglet);
    document.querySelectorAll("[data-mtab]").forEach((element) => element.classList.toggle("actif", element.dataset.mtab === onglet));
    onglets[onglet]();
  };
  document.querySelectorAll("[data-mtab]").forEach((button) => button.addEventListener("click", () => afficherOnglet(button.dataset.mtab, true)));
  window.addEventListener("hashchange", () => afficherOnglet(ongletDepuisUrl(Object.keys(onglets), "apercu")));
  afficherOnglet(ongletDepuisUrl(Object.keys(onglets), "apercu"));
  abonnerCommandes(donnees.boutique.id);
  rafraichirIcones(app);
}

function ouvrirNouvelEtablissement(organisation) {
  document.querySelector("#dialog-title").textContent = "Nouvel établissement";
  document.querySelector("#dialog-zone").innerHTML = `<form id="établissement-form"><div class="champ"><label>Nom</label><input name="nom" minlength="2" maxlength="120" required></div><div class="champ"><label>Adresse web du Site dédié</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required><span class="champ-aide">Exemple : soum-cosmetique-abidjan</span></div><button class="btn btn-primaire btn-bloc">${icone("plus")} Creer l'établissement</button></form>`;
  const nom = document.querySelector('#établissement-form [name="nom"]');
  const slug = document.querySelector('#établissement-form [name="slug"]');
  let modifie = false;
  slug.addEventListener("input", () => { modifie = true; });
  nom.addEventListener("input", () => { if (!modifie) slug.value = slugifier(nom.value); });
  document.querySelector("#établissement-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    const { data, error } = await supabase.rpc("rpc_creer_boutique_marketplace", {
      p_organisation_id: organisation.id,
      p_nom: valeurs.nom,
      p_slug: valeurs.slug,
    });
    if (error) return gererErreur(error);
    location.href = `./marchand.html?organisation=${organisation.id}&boutique=${data}#site-dedie`;
  });
  document.querySelector("#marchand-dialog").showModal();
  rafraichirIcones(document.querySelector("#dialog-zone"));
}

function afficherApercu(donnees, nouvelles, stockFaible) {
  const zone = document.querySelector("#marchand-zone");
  const recentes = donnees.commandes.slice(0, 5);
  const missions = donnees.commandes
    .map((commande) => Array.isArray(commande.missions_logistiques) ? commande.missions_logistiques[0] : commande.missions_logistiques)
    .filter(Boolean);
  const enCours = missions.filter((mission) => ["ENVOYEE", "ACCEPTEE", "EN_COURS"].includes(mission.statut)).length;
  const livrees = missions.filter((mission) => mission.statut === "LIVREE").length;
  const incidents = missions.filter((mission) => ["ERREUR", "RETOUR", "ANNULEE"].includes(mission.statut) || mission.derniere_erreur).length;
  const tauxLivraison = missions.length ? Math.round((livrees / missions.length) * 100) : 0;
  zone.innerHTML = `<div class="entete-page"><div><h2>Aujourd'hui</h2><p class="muted petit">Les priorites de la boutique</p></div></div><div class="grille-deux"><button class="carte carte-lien" data-raccourci="commandes" style="text-align:left"><span class="badge badge-attention">${nouvelles}</span><h3 style="margin-top:12px">Commandes a traiter</h3><p class="muted petit">Confirmer, preparer puis remettre a la livraison.</p></button><button class="carte carte-lien" data-raccourci="produits" style="text-align:left"><span class="badge ${stockFaible ? "badge-danger" : "badge-succes"}">${stockFaible}</span><h3 style="margin-top:12px">Alertes de stock</h3><p class="muted petit">Articles avec cinq unites ou moins.</p></button></div><section class="section"><div class="ligne-entre"><div><h2>Performance livraison</h2><p class="muted petit">Donnees logistiques deja recues par Marketplace.</p></div>${incidents ? `<span class="badge badge-danger">${incidents} a verifier</span>` : '<span class="badge badge-succes">Flux sain</span>'}</div><div class="grille-quatre suivi-kpis"><div class="carte"><span class="muted petit">En cours</span><strong>${enCours}</strong></div><div class="carte"><span class="muted petit">Livrees</span><strong>${livrees}</strong></div><div class="carte"><span class="muted petit">Taux de livraison</span><strong>${tauxLivraison}%</strong></div><div class="carte"><span class="muted petit">Retours / erreurs</span><strong>${incidents}</strong></div></div></section><section class="section"><h2>Dernieres commandes</h2>${recentes.length ? `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Date</th><th>Total</th><th>Statut</th></tr></thead><tbody>${recentes.map((commande) => `<tr><td><strong>${escapeHtml(commande.reference)}</strong></td><td>${formatDate(commande.cree_le, true)}</td><td>${fcfa(commande.total)}${commande.frais_livraison_a_confirmer && commande.statut !== "ANNULEE" ? " + livraison" : ""}</td><td>${badgeStatut(commande.statut)}</td></tr>`).join("")}</tbody></table></div>` : vide("package-open", "Aucune commande", "Les nouvelles commandes apparaitront ici en temps reel.")}</section>`;
  zone.querySelectorAll("[data-raccourci]").forEach((button) => button.addEventListener("click", () => document.querySelector(`[data-mtab="${button.dataset.raccourci}"]`)?.click()));
  rafraichirIcones(zone);
}

function afficherCommandes(donnees) {
  const zone = document.querySelector("#marchand-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Commandes</h2><p class="muted petit">Traite les commandes sans ouvrir chaque fiche.</p></div><select id="filtre-commandes" class="btn btn-secondaire"><option value="">Tous les statuts</option><option>NOUVELLE</option><option>CONFIRMEE</option><option>EN_PREPARATION</option><option>PRETE</option><option>EN_LIVRAISON</option><option>LIVREE</option><option>ANNULEE</option></select></div><div id="commandes-liste"></div>`;
  const afficherListe = () => {
    const filtre = document.querySelector("#filtre-commandes").value;
    const commandes = donnees.commandes.filter((commande) => !filtre || commande.statut === filtre);
    document.querySelector("#commandes-liste").innerHTML = commandes.length ? `<div class="pile">${commandes.map((commande) => {
      const action = prochaineAction(commande.statut);
      const adresse = commande.achats?.adresses_livraison || {};
      const mission = Array.isArray(commande.missions_logistiques) ? commande.missions_logistiques[0] : commande.missions_logistiques;
      const fraisAConfirmer = commande.frais_livraison_a_confirmer && commande.statut !== "ANNULEE";
      return `<article class="carte"><div class="ligne-entre"><div><p class="muted petit">${formatDate(commande.cree_le, true)} · ${escapeHtml(adresse.destinataire_nom || "Client")}</p><h3 style="margin:4px 0">${escapeHtml(commande.reference)}</h3><p class="muted petit" style="margin:0">${escapeHtml(adresse.commune || adresse.adresse || "")}${mission?.derniere_erreur ? ` · IKMS : ${escapeHtml(mission.derniere_erreur)}` : ""}</p></div><div style="text-align:right">${badgeStatut(commande.statut)}<strong style="display:block;margin-top:8px">${fcfa(commande.total)}${fraisAConfirmer ? " + livraison" : ""}</strong>${fraisAConfirmer ? '<span class="muted petit">tarif a confirmer</span>' : ""}</div></div><div class="ligne-entre" style="margin-top:14px;align-items:flex-end"><div class="pile" style="gap:5px">${(commande.lignes_commande_marketplace || []).slice(0, 3).map((ligne) => `<span class="petit">${escapeHtml(ligne.nom_produit)} · ${ligne.quantite} x ${fcfa(ligne.prix_unitaire)}</span>`).join("")}${(commande.lignes_commande_marketplace || []).length > 3 ? `<span class="muted petit">+${commande.lignes_commande_marketplace.length - 3} article(s)</span>` : ""}</div><div class="ligne" style="justify-content:flex-end">${action ? `<button class="btn btn-primaire" data-action-commande="${commande.id}">${icone(action.icone)} ${action.libelle}</button>` : ""}${["NOUVELLE", "CONFIRMEE", "EN_PREPARATION", "PRETE"].includes(commande.statut) ? `<button class="btn btn-danger" data-annuler-commande="${commande.id}">${icone("x-circle")} Annuler</button>` : ""}<button class="btn btn-secondaire" data-commande="${commande.id}">${icone("eye")} Details</button></div></div></article>`;
    }).join("")}</div>` : vide("package-open", "Aucune commande dans cette vue");
    document.querySelectorAll("[data-commande]").forEach((button) => button.addEventListener("click", () => ouvrirCommande(donnees, button.dataset.commande)));
    document.querySelectorAll("[data-action-commande]").forEach((button) => button.addEventListener("click", () => {
      const commande = donnees.commandes.find((element) => element.id === button.dataset.actionCommande);
      const action = prochaineAction(commande?.statut);
      if (commande && action) executerActionCommande(donnees, commande, action, button);
    }));
    document.querySelectorAll("[data-annuler-commande]").forEach((button) => button.addEventListener("click", () => {
      const commande = donnees.commandes.find((element) => element.id === button.dataset.annulerCommande);
      if (commande) annulerCommandeMarchand(commande, button);
    }));
    rafraichirIcones(document.querySelector("#commandes-liste"));
  };
  document.querySelector("#filtre-commandes").addEventListener("change", afficherListe);
  afficherListe();
}

function ouvrirCommande(donnees, commandeId) {
  const commande = donnees.commandes.find((element) => element.id === commandeId);
  const adresse = commande.achats?.adresses_livraison || {};
  const mission = Array.isArray(commande.missions_logistiques) ? commande.missions_logistiques[0] : commande.missions_logistiques;
  const action = prochaineAction(commande.statut);
  const fraisAConfirmer = commande.frais_livraison_a_confirmer && commande.statut !== "ANNULEE";
  document.querySelector("#dialog-title").textContent = commande.reference;
  document.querySelector("#dialog-zone").innerHTML = `<div class="ligne-entre"><div><p class="muted petit">${formatDate(commande.cree_le, true)}</p>${badgeStatut(commande.statut)}</div><div style="text-align:right"><strong>${fcfa(commande.total)}${fraisAConfirmer ? " + livraison" : ""}</strong>${fraisAConfirmer ? '<p class="muted petit" style="margin:3px 0 0">Tarif definitif a confirmer</p>' : ""}</div></div><hr class="separateur"><div><h3>Articles</h3><div class="pile">${(commande.lignes_commande_marketplace || []).map((ligne) => `<div class="ligne"><img src="${escapeHtml(ligne.image_url || etat.configuration.hero_image_url)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:6px"><div style="flex:1"><strong>${escapeHtml(ligne.nom_produit)}</strong><p class="muted petit" style="margin:4px 0">${escapeHtml(ligne.nom_variante)} - ${ligne.quantite} x ${fcfa(ligne.prix_unitaire)}</p></div></div>`).join("")}</div></div><hr class="separateur"><div><h3>Livraison</h3><p class="muted petit">${escapeHtml(adresse.destinataire_nom || "Client")} - ${escapeHtml(adresse.telephone || "")}<br>${escapeHtml(adresse.adresse || "")} ${escapeHtml(adresse.commune || "")}<br>Zone : ${escapeHtml(adresse.code_zone || "Non renseignee")}<br>${escapeHtml(adresse.indications || "")}</p></div><div class="suivi-commande-marchand"><div><strong>Suivi Marketplace</strong>${mission?.commande_livraison_externe_id ? `<p class="muted petit">Reference transporteur : ${escapeHtml(mission.commande_livraison_externe_id)}</p>` : ""}</div>${rendreParcoursLivraison(commande.statut)}${rendreCodesMission(mission, { marchand: true })}${rendreComparaisonFrais(commande, mission)}</div>${mission?.derniere_erreur ? `<div class="bande-info bande-danger"><strong>Incident de livraison</strong><p class="petit">${escapeHtml(mission.derniere_erreur)}</p></div>` : ""}${commande.note_client ? `<div class="bande-info"><strong>Note client</strong><p class="petit" style="margin:5px 0 0">${escapeHtml(commande.note_client)}</p></div>` : ""}<div class="ligne" style="margin-top:18px">${action ? `<button class="btn btn-primaire" id="action-commande">${icone(action.icone)} ${action.libelle}</button>` : ""}${["NOUVELLE", "CONFIRMEE", "EN_PREPARATION", "PRETE"].includes(commande.statut) ? `<button class="btn btn-danger" id="annuler-commande">${icone("x-circle")} Annuler</button>` : ""}</div>`;
  document.querySelector("#action-commande")?.addEventListener("click", async (event) => {
    executerActionCommande(donnees, commande, action, event.currentTarget);
  });
  document.querySelector("#annuler-commande")?.addEventListener("click", async (event) => {
    annulerCommandeMarchand(commande, event.currentTarget);
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
  const categorieSelectionnee = produit?.categorie_boutique_id
    ? `SITE:${produit.categorie_boutique_id}`
    : (produit?.categorie_id ? `GLOBAL:${produit.categorie_id}` : "");
  const optionsCategories = [
    ...donnees.categoriesBoutique.map((categorie) => ({ ...categorie, valeur: `SITE:${categorie.id}`, groupe: "Catégories du Site dédié" })),
    ...donnees.categories.map((categorie) => ({ ...categorie, valeur: `GLOBAL:${categorie.id}`, groupe: "Categories marketplace" })),
  ];
  document.querySelector("#dialog-title").textContent = produit ? "Modifier le produit" : "Nouveau produit";
  document.querySelector("#dialog-zone").innerHTML = `<form id="produit-form"><div class="champ"><label>Nom</label><input name="nom" minlength="2" maxlength="160" value="${escapeHtml(produit?.nom)}" required><span class="champ-aide">2 a 160 caracteres.</span></div><div class="grille-deux"><div class="champ"><label>Marque</label><input name="marque" maxlength="100" value="${escapeHtml(produit?.marque)}"></div><div class="champ"><label>Categorie</label><select name="categorie_id"><option value="">Sans categorie</option>${optionsCategories.map((categorie) => `<option value="${categorie.valeur}" ${categorie.valeur === categorieSelectionnee ? "selected" : ""}>${escapeHtml(categorie.nom)} · ${escapeHtml(categorie.groupe)}</option>`).join("")}</select></div></div><div class="champ"><label>Description</label><textarea name="description" maxlength="5000">${escapeHtml(produit?.description)}</textarea><span class="champ-aide">5 000 caracteres maximum.</span></div><div class="grille-deux"><div class="champ"><label>Prix (FCFA)</label><input name="prix" type="number" min="1" max="2000000000" step="1" value="${produit?.prix ?? ""}" required></div><div class="champ"><label>Stock</label><input name="stock" type="number" min="0" max="1000000" step="1" value="${stock}" required></div></div><div class="champ"><label>Statut</label><select name="statut"><option value="ACTIF" ${produit?.statut === "ACTIF" ? "selected" : ""}>Actif</option><option value="BROUILLON" ${produit?.statut === "BROUILLON" ? "selected" : ""}>Brouillon</option><option value="EPUISE" ${produit?.statut === "EPUISE" ? "selected" : ""}>Epuise</option><option value="ARCHIVE" ${produit?.statut === "ARCHIVE" ? "selected" : ""}>Archive</option></select></div><div class="champ"><label>Photos</label><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="champ-aide">6 images maximum, 5 Mo par image. Une photo est obligatoire pour publier.</span></div>${produit?.images?.length ? `<div class="ligne" style="overflow-x:auto">${produit.images.map((image) => `<img src="${escapeHtml(image)}" alt="" style="width:70px;height:70px;object-fit:cover;border-radius:6px">`).join("")}</div>` : ""}<button class="btn btn-primaire btn-bloc" id="sauver-produit" style="margin-top:17px">${icone("save")} Enregistrer le produit</button></form>`;
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
      const [typeCategorie, categorieId] = String(valeurs.categorie_id || "").split(":");
      const { error } = await supabase.rpc("rpc_enregistrer_produit_vitrine", {
        p_boutique_id: donnees.boutique.id,
        p_nom: valeurs.nom,
        p_prix: Number(valeurs.prix),
        p_stock: Number(valeurs.stock),
        p_produit_id: produit?.id || null,
        p_categorie_id: typeCategorie === "GLOBAL" ? categorieId : null,
        p_categorie_boutique_id: typeCategorie === "SITE" ? categorieId : null,
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
  zone.innerHTML = `<form class="carte" id="boutique-form"><h2>Personnaliser la boutique</h2><div class="champ"><label>Nom</label><input name="nom" minlength="2" maxlength="120" value="${escapeHtml(boutique.nom)}" required></div><div class="champ"><label>Description</label><textarea name="description" maxlength="2000">${escapeHtml(boutique.description)}</textarea></div><div class="grille-deux"><div class="champ"><label>Telephone</label><input name="telephone" type="tel" maxlength="30" value="${escapeHtml(boutique.telephone)}"></div><div class="champ"><label>WhatsApp</label><input name="whatsapp" type="tel" maxlength="30" value="${escapeHtml(boutique.whatsapp)}"></div></div><div class="champ"><label>Email de contact</label><input name="email_contact" type="email" maxlength="254" value="${escapeHtml(boutique.email_contact)}"></div><div class="champ"><label>Adresse</label><input name="adresse" maxlength="500" value="${escapeHtml(boutique.adresse)}"></div><div class="champ"><label>Delai de preparation (minutes)</label><input name="delai_preparation_minutes" type="number" min="0" max="10080" value="${boutique.delai_preparation_minutes || 60}"></div><div class="bande-info"><strong>Tarif de livraison automatique</strong><p class="petit" style="margin:5px 0 0">Le prix est calcule par IKMS entre votre zone de ramassage et celle du client.</p></div><div class="champ"><label>Publication</label><select name="statut"><option value="BROUILLON" ${boutique.statut === "BROUILLON" ? "selected" : ""}>Brouillon</option><option value="PUBLIEE" ${boutique.statut === "PUBLIEE" ? "selected" : ""}>Publiee</option></select></div><div class="grille-deux"><div class="champ"><label>Logo</label><input name="logo" type="file" accept="image/jpeg,image/png,image/webp">${boutique.logo_url ? `<img src="${escapeHtml(boutique.logo_url)}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:6px">` : ""}</div><div class="champ"><label>Banniere</label><input name="banniere" type="file" accept="image/jpeg,image/png,image/webp">${boutique.banniere_url ? `<img src="${escapeHtml(boutique.banniere_url)}" alt="" style="width:160px;height:90px;object-fit:cover;border-radius:6px">` : ""}</div></div><button class="btn btn-primaire" id="sauver-boutique">${icone("save")} Enregistrer</button></form>`;
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

function afficherSiteDedie(donnees) {
  const zone = document.querySelector("#marchand-zone");
  const boutique = donnees.boutique;
  const configuration = donnees.configurationSite || {};
  const filtres = configuration.filtres_actifs || { prix: true, note: true, stock: true, tri: true };
  const heroes = Array.isArray(configuration.hero_images) && configuration.hero_images.length
    ? configuration.hero_images
    : [boutique.banniere_url].filter(Boolean);
  zone.innerHTML = `<div class="entete-page"><div><h2>Site dédié</h2><p class="muted petit">Theme, bandeau, filtres et categories propres a cette URL.</p></div><a class="btn btn-secondaire" href="./index.html?site=${encodeURIComponent(boutique.slug)}" target="_blank" rel="noopener">${icone("external-link")} Ouvrir</a></div><form class="carte" id="site-dedie-form"><div class="grille-deux"><div class="champ"><label>Nom du site</label><input name="nom_site" maxlength="120" value="${escapeHtml(configuration.nom_site || boutique.nom)}" required></div><div class="champ"><label>Slogan</label><input name="slogan" maxlength="200" value="${escapeHtml(configuration.slogan)}"></div></div><div class="champ"><label>Annonce du bandeau</label><input name="annonce" maxlength="300" value="${escapeHtml(configuration.annonce)}"></div><div class="champ"><label>Description</label><textarea name="description" maxlength="2000">${escapeHtml(configuration.description || boutique.description)}</textarea></div><div class="grille-trois"><div class="champ"><label>Couleur principale</label><input name="couleur_primaire" type="color" value="${escapeHtml(configuration.couleur_primaire || "#C75332")}"></div><div class="champ"><label>Couleur secondaire</label><input name="couleur_secondaire" type="color" value="${escapeHtml(configuration.couleur_secondaire || "#17211F")}"></div><div class="champ"><label>Accent</label><input name="couleur_accent" type="color" value="${escapeHtml(configuration.couleur_accent || "#E9AE36")}"></div></div><div class="grille-deux"><div class="champ"><label>Logo du Site dédié</label><input name="logo" type="file" accept="image/jpeg,image/png,image/webp">${configuration.logo_url ? `<img src="${escapeHtml(configuration.logo_url)}" alt="" style="width:84px;height:84px;object-fit:contain">` : ""}</div><div class="champ"><label>Images du bandeau</label><input name="heroes" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="champ-aide">Jusqu'a 6 images. Une nouvelle selection remplace le bandeau.</span></div></div>${heroes.length ? `<div class="galerie-bandeau-admin">${heroes.map((image) => `<div class="media-admin media-admin-bandeau"><img src="${escapeHtml(image)}" alt=""></div>`).join("")}</div>` : ""}<div class="grille-deux"><div><h3>Contenu visible</h3><label class="case"><input name="masquer_autres_boutiques" type="checkbox" ${configuration.masquer_autres_boutiques !== false ? "checked" : ""}> Masquer les autres boutiques</label><label class="case"><input name="masquer_categories_globales" type="checkbox" ${configuration.masquer_categories_globales !== false ? "checked" : ""}> Masquer les categories marketplace</label><label class="case"><input name="afficher_signature_plateforme" type="checkbox" ${configuration.afficher_signature_plateforme ? "checked" : ""}> Afficher la signature IKIGAI</label></div><div><h3>Filtres actifs</h3>${["prix", "note", "stock", "tri"].map((cle) => `<label class="case"><input name="filtre_${cle}" type="checkbox" ${filtres[cle] !== false ? "checked" : ""}> ${escapeHtml({ prix: "Prix", note: "Avis", stock: "Disponibilité", tri: "Tri" }[cle])}</label>`).join("")}</div></div><div class="grille-deux"><div class="champ"><label>Titre SEO</label><input name="seo_titre" maxlength="160" value="${escapeHtml(configuration.seo_titre)}"></div><div class="champ"><label>Description SEO</label><input name="seo_description" maxlength="300" value="${escapeHtml(configuration.seo_description)}"></div></div><button class="btn btn-primaire" id="sauver-site-dedie">${icone("save")} Enregistrer le Site dédié</button></form><section class="section"><div class="entete-page"><div><h2>Categories du Site dédié</h2><p class="muted petit">Elles sont propres a cet établissement.</p></div></div><form class="carte ligne" id="categorie-site-form"><input name="nom" minlength="2" maxlength="120" placeholder="Nouvelle categorie" required><input name="image_url" type="url" placeholder="URL image (facultatif)"><button class="btn btn-primaire">${icone("plus")} Ajouter</button></form><div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Categorie</th><th>Adresse</th><th>Statut</th><th></th></tr></thead><tbody>${donnees.categoriesBoutique.map((categorie) => `<tr><td><strong>${escapeHtml(categorie.nom)}</strong></td><td>${escapeHtml(categorie.slug)}</td><td>${badgeStatut(categorie.actif ? "ACTIF" : "SUSPENDUE")}</td><td><button class="btn btn-secondaire" data-basculer-categorie="${categorie.id}" data-actif="${categorie.actif}">${categorie.actif ? "Masquer" : "Afficher"}</button></td></tr>`).join("") || '<tr><td colspan="4" class="muted">Aucune categorie propre.</td></tr>'}</tbody></table></div></section>${donnees.offre.domaines_personnalises ? `<section class="section"><div class="entete-page"><div><h2>Domaines personnalises</h2><p class="muted petit">Ajoute le domaine, puis communique le jeton de verification au support.</p></div></div><form class="carte ligne" id="domaine-form"><input name="domaine" placeholder="boutique.exemple.com" required><button class="btn btn-primaire">${icone("globe-2")} Ajouter</button></form><div class="pile" style="margin-top:14px">${donnees.domaines.map((domaine) => `<div class="carte"><div class="ligne-entre"><strong>${escapeHtml(domaine.domaine)}</strong>${badgeStatut(domaine.statut)}</div><p class="petit muted" style="word-break:break-all">Jeton : ${escapeHtml(domaine.jeton_verification)}</p></div>`).join("") || '<p class="muted">Aucun domaine ajoute.</p>'}</div></section>` : ""}`;

  zone.querySelector("#site-dedie-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = zone.querySelector("#sauver-site-dedie");
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    try {
      const logo = form.elements.logo.files[0]
        ? await televerserImage(form.elements.logo.files[0], `${boutique.id}/site-dedie`)
        : (configuration.logo_url || boutique.logo_url);
      const fichiers = [...form.elements.heroes.files];
      if (fichiers.length > 6) throw new Error("Le bandeau accepte 6 images maximum.");
      const heroImages = fichiers.length
        ? await Promise.all(fichiers.map((fichier) => televerserImage(fichier, `${boutique.id}/site-dedie/bandeau`)))
        : heroes;
      const formulaire = new FormData(form);
      const payload = {
        boutique_id: boutique.id,
        nom_site: valeurs.nom_site,
        slogan: valeurs.slogan || null,
        annonce: valeurs.annonce || null,
        description: valeurs.description || null,
        logo_url: logo || null,
        hero_images: heroImages,
        couleur_primaire: valeurs.couleur_primaire,
        couleur_secondaire: valeurs.couleur_secondaire,
        couleur_accent: valeurs.couleur_accent,
        masquer_autres_boutiques: formulaire.has("masquer_autres_boutiques"),
        masquer_categories_globales: formulaire.has("masquer_categories_globales"),
        afficher_signature_plateforme: formulaire.has("afficher_signature_plateforme"),
        filtres_actifs: Object.fromEntries(["prix", "note", "stock", "tri"].map((cle) => [cle, formulaire.has(`filtre_${cle}`)])),
        seo_titre: valeurs.seo_titre || null,
        seo_description: valeurs.seo_description || null,
      };
      const { error } = await supabase.from("configurations_boutique").upsert(payload, { onConflict: "boutique_id" });
      if (error) throw error;
      const { error: modeError } = await supabase.from("boutiques").update({ mode_vitrine: "WHITE_LABEL" }).eq("id", boutique.id);
      if (modeError) throw modeError;
      toast("Site dédié mis a jour");
      location.reload();
    } catch (error) {
      boutonOccupe(button, false);
      gererErreur(error);
    }
  });
  zone.querySelector("#categorie-site-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    const { error } = await supabase.from("categories_boutique").insert({
      boutique_id: boutique.id,
      nom: valeurs.nom.trim(),
      slug: slugifier(valeurs.nom),
      image_url: valeurs.image_url?.trim() || null,
    });
    if (error) return gererErreur(error);
    toast("Catégorie ajoutée");
    location.reload();
  });
  zone.querySelectorAll("[data-basculer-categorie]").forEach((button) => button.addEventListener("click", async () => {
    const { error } = await supabase.from("categories_boutique").update({ actif: button.dataset.actif !== "true" }).eq("id", button.dataset.basculerCategorie);
    if (error) return gererErreur(error);
    location.reload();
  }));
  zone.querySelector("#domaine-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeur = String(new FormData(event.currentTarget).get("domaine") || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const { error } = await supabase.rpc("rpc_ajouter_domaine_boutique", {
      p_boutique_id: boutique.id,
      p_domaine: valeur,
    });
    if (error) return gererErreur(error);
    toast("Domaine ajouté, vérification en attente");
    location.reload();
  });
  rafraichirIcones(zone);
}

function afficherPaiements(organisation, donnees) {
  const zone = document.querySelector("#marchand-zone");
  const wave = donnees.wave || {};
  zone.innerHTML = `<div class="entete-page"><div><h2>Paiements du tenant</h2><p class="muted petit">Une configuration Wave propre a ${escapeHtml(organisation.nom)}, partagee par ses etablissements.</p></div>${badgeStatut(wave.actif ? "ACTIF" : "SUSPENDUE")}</div><div class="bande-info bande-attention"><strong>Activation progressive</strong><p class="petit" style="margin:5px 0 0">Les secrets peuvent etre prepares maintenant. Wave restera masque au checkout jusqu'a l'activation du parcours de paiement multi-tenant.</p></div><form class="carte" id="wave-form" style="margin-top:15px"><div class="champ"><label>Cle API Wave Business</label><input name="api_key" type="password" autocomplete="new-password" placeholder="${wave.api_key_configuree ? `Configuree (termine par ${escapeHtml(wave.api_key_suffixe || "****")})` : "wave_..."}"><span class="champ-aide">La cle est chiffree dans Supabase Vault et n'est jamais envoyee au navigateur.</span></div><div class="champ"><label>Secret de signature Wave</label><input name="signing_secret" type="password" autocomplete="new-password" placeholder="${wave.signing_secret_configure ? "Configure — laisser vide pour conserver" : "wave_..."}"></div><label class="case"><input name="actif" type="checkbox" ${wave.actif ? "checked" : ""}> Marquer la configuration comme prete</label><button class="btn btn-primaire" style="margin-top:16px">${icone("lock-keyhole")} Enregistrer Wave pour ce tenant</button></form>`;
  zone.querySelector("#wave-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    const { error } = await supabase.rpc("rpc_configurer_wave_organisation", {
      p_organisation_id: organisation.id,
      p_api_key: valeurs.api_key || null,
      p_signing_secret: valeurs.signing_secret || null,
      p_actif: new FormData(form).has("actif"),
    });
    if (error) return gererErreur(error);
    toast("Configuration Wave du tenant enregistree");
    location.reload();
  });
  rafraichirIcones(zone);
}

async function afficherLivraison(donnees) {
  const zone = document.querySelector("#marchand-zone");
  const integration = donnees.integration || {};
  const modePaiement = integration.mode_paiement || "A_LA_LIVRAISON";
  const configuration = etat.configuration;
  const catalogueZones = await chargerZonesIkms(configuration);
  const optionsZones = catalogueZones.zones
    .map((element) => `<option value="${escapeHtml(element.code)}" ${element.code === integration.zone_depart ? "selected" : ""}>${escapeHtml(element.nom || element.code)}</option>`)
    .join("");
  const portail = configuration.ikms_portail_pro_url
    ? `<a class="btn btn-secondaire" href="${escapeHtml(configuration.ikms_portail_pro_url)}" target="_blank" rel="noopener">${icone("external-link")} Creer mon compte pro</a>`
    : "";
  zone.innerHTML = `<div class="ligne-entre"><div><h2>${escapeHtml(configuration.ikms_tenant_nom || "IKIGAI Livraison")}</h2><p class="muted petit">Tenant logistique : ${escapeHtml(configuration.ikms_tenant_code || "Non configure")}</p></div>${portail}</div><div class="bande-info ${integration.actif ? "" : "bande-attention"}" style="margin-top:14px"><strong>${integration.actif ? "Connexion active" : "Connexion inactive"}</strong><p class="petit" style="margin:5px 0 0">Cle API : ${integration.cle_api_configuree ? "configuree dans le coffre securise" : "a renseigner"}</p></div><form class="carte" id="livraison-form" style="margin-top:15px"><h2>Compte client pro IKMS</h2><div class="grille-deux"><div class="champ"><label>Zone de ramassage</label>${optionsZones ? `<select name="zone_depart" required><option value="">Choisir une zone</option>${optionsZones}</select>` : `<input name="zone_depart" value="${escapeHtml(integration.zone_depart)}" placeholder="COCODY" required>`}<span class="champ-aide">Liste synchronisee avec la grille IKMS.</span></div><div class="champ"><label>Mode de paiement logistique</label><select name="mode_paiement"><option value="A_LA_LIVRAISON" ${modePaiement === "A_LA_LIVRAISON" ? "selected" : ""}>Paiement destinataire</option><option value="PAR_EXPEDITEUR" ${modePaiement === "PAR_EXPEDITEUR" ? "selected" : ""}>Paiement au ramassage</option><option value="SANS_PAIEMENT" ${modePaiement === "SANS_PAIEMENT" ? "selected" : ""}>Facture compte pro</option></select><span class="champ-aide">Facture compte pro fonctionne seulement si IKMS a active la facturation differee pour cette cle.</span></div></div><div class="champ"><label>Nom au ramassage</label><input name="expediteur_nom" value="${escapeHtml(integration.expediteur_nom || donnees.boutique.nom)}" required></div><div class="grille-deux"><div class="champ"><label>Telephone de ramassage</label><input name="expediteur_tel" type="tel" value="${escapeHtml(integration.expediteur_tel || donnees.boutique.telephone)}" placeholder="0700000000" required></div><div class="champ"><label>Adresse de ramassage</label><input name="expediteur_adresse" value="${escapeHtml(integration.expediteur_adresse || donnees.boutique.adresse)}" required></div></div><div class="champ"><label>Cle API client pro</label><input name="api_key" type="password" autocomplete="new-password" placeholder="${integration.cle_api_configuree ? "Laisser vide pour conserver la cle" : "ik_live_..."}"></div><label class="case"><input name="actif" type="checkbox" ${integration.actif ? "checked" : ""}> Activer la transmission a IKMS</label><button class="btn btn-primaire" style="margin-top:16px">${icone("lock-keyhole")} Enregistrer la connexion</button></form>`;
  zone.querySelector("#livraison-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    const telephone = normaliserTelephoneRamassage(valeurs.expediteur_tel);
    const { error } = await supabase.rpc("rpc_configurer_integration_ikms_boutique", {
      p_boutique_id: donnees.boutique.id,
      p_zone_depart: String(valeurs.zone_depart || "").toUpperCase(),
      p_expediteur_nom: valeurs.expediteur_nom,
      p_expediteur_tel: telephone,
      p_expediteur_adresse: valeurs.expediteur_adresse,
      p_mode_paiement: valeurs.mode_paiement,
      p_api_key: valeurs.api_key || null,
      p_actif: new FormData(form).has("actif"),
    });
    if (error) return gererErreur(error);
    toast("Connexion IKMS enregistree");
    location.reload();
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
