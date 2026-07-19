import {
  appliquerTheme,
  boutonOccupe,
  chargerZonesIkms,
  configurationDefaut,
  escapeHtml,
  fcfa,
  formatDate,
  icone,
  memoriserOnglet,
  messageErreur,
  ongletDepuisUrl,
  rafraichirIcones,
  slugifier,
  supabase,
  supprimerImageStockage,
  televerserImage,
  toast,
} from "../assets/api.js?v=17";
import {
  app,
  badgeStatut,
  coquille,
  demanderConnexion,
  etat,
  gererErreur,
  squelettePage,
  vide,
} from "./shared.js?v=17";

async function verifierAdmin() {
  const { data, error } = await supabase
    .from("administrateurs_plateforme")
    .select("role, actif")
    .eq("identite_id", etat.session.user.id)
    .eq("actif", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function afficherInitialisation() {
  coquille(`<main class="conteneur conteneur-etroit"><div class="vide" style="margin-top:40px">${icone("shield-check")}<h1>Administration non attribuee</h1><p>Le tout premier compte peut initialiser une seule fois le role SuperAdmin. Si un administrateur existe deja, cette action sera refusee.</p><button class="btn btn-primaire" id="initialiser-admin">Initialiser le premier SuperAdmin</button><a class="btn btn-secondaire" href="./index.html">Retour au site</a></div></main>`, { mode: "gestion", espace: "Administration" });
  document.querySelector("#initialiser-admin").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    boutonOccupe(button, true, "Verification...");
    const { error } = await supabase.rpc("rpc_reclamer_super_admin");
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Role SuperAdmin active");
    location.reload();
  });
  rafraichirIcones(app);
}

async function chargerAdministration() {
  const resultats = await Promise.all([
    supabase.from("organisations").select("id, nom, slug, type, actif, cree_le, membres_organisation(identite_id, role, statut), offres_organisations(offre, white_label_actif, domaines_personnalises, max_etablissements, active)").order("cree_le", { ascending: false }),
    supabase.from("boutiques").select("id, organisation_id, nom, slug, mode_vitrine, statut, note_moyenne, cree_le, organisations(nom, type)").order("cree_le", { ascending: false }),
    supabase.from("produits").select("id, boutique_id, statut", { count: "exact" }),
    supabase.from("commandes_marketplace").select("id, reference, boutique_id, statut, total, cree_le, boutiques(nom)").order("cree_le", { ascending: false }).limit(300),
    supabase.from("missions_logistiques").select("id, commande_id, statut, statut_ikms, commande_livraison_externe_id, tentatives, derniere_erreur, derniere_synchronisation, cree_le, commandes_marketplace(reference, boutiques(nom))").order("cree_le", { ascending: false }).limit(100),
    supabase.from("categories_marketplace").select("*").order("ordre").order("nom"),
    supabase.from("configuration_marketplace").select("*").eq("id", 1).single(),
    supabase.from("administrateurs_plateforme").select("identite_id, role, actif, identites(prenom, nom, email)").order("cree_le"),
    supabase.from("identites").select("id", { count: "exact", head: true }),
    supabase.from("domaines_boutique").select("id, boutique_id, domaine, statut, principal, verifie_le, boutiques(nom)").order("cree_le", { ascending: false }),
  ]);
  const erreur = resultats.map((resultat) => resultat.error).find(Boolean);
  if (erreur) throw erreur;
  return {
    organisations: resultats[0].data || [],
    boutiques: resultats[1].data || [],
    produits: resultats[2].data || [],
    produitsCount: resultats[2].count || 0,
    commandes: resultats[3].data || [],
    missions: resultats[4].data || [],
    categories: resultats[5].data || [],
    configuration: resultats[6].data || etat.configuration,
    administrateurs: resultats[7].data || [],
    identitesCount: resultats[8].count || 0,
    domaines: resultats[9].data || [],
  };
}

export async function rendreAdmin() {
  if (!etat.session) return demanderConnexion();
  coquille(squelettePage("contenu"), { mode: "gestion", espace: "Administration" });
  try {
    const admin = await verifierAdmin();
    if (!admin) { afficherInitialisation(); return; }
    const donnees = await chargerAdministration();
    afficherAdministration(admin, donnees);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Administration indisponible", messageErreur(error))}</main>`, { mode: "gestion", espace: "Administration" });
  }
}

function afficherAdministration(admin, donnees) {
  const navigation = `<nav class="navigation-desktop"><a href="./admin.html#tableau" class="actif">Pilotage</a><a href="./admin.html#boutiques">Marchands</a><a href="./index.html">Site public</a></nav>`;
  coquille(`<main class="conteneur"><div class="entete-page"><div><p class="muted petit">${escapeHtml(admin.role)}</p><h1>Administration IKIGAI Market</h1><p class="muted">Tenants, catalogue, commandes et apparence</p></div><a class="btn btn-secondaire" href="./index.html">${icone("external-link")} Voir le site</a></div><div class="mise-en-page"><nav class="menu-lateral"><button class="actif" data-atab="tableau">${icone("layout-dashboard")} Tableau de bord</button><button data-atab="tenants">${icone("building-2")} Tenants</button><button data-atab="boutiques">${icone("store")} Boutiques</button><button data-atab="categories">${icone("layout-grid")} Categories</button><button data-atab="apparence">${icone("palette")} Apparence</button><button data-atab="livraisons">${icone("truck")} Livraisons</button></nav><section id="admin-zone"></section></div></main><dialog class="dialogue" id="admin-dialog"><div class="dialogue-entete"><h2 id="admin-dialog-title"></h2><button class="dialogue-fermer" data-fermer aria-label="Fermer">${icone("x")}</button></div><div class="dialogue-corps" id="admin-dialog-zone"></div></dialog>`, { mode: "gestion", espace: "Administration", navigation });
  const onglets = {
    tableau: () => afficherTableau(donnees),
    tenants: () => afficherTenants(admin, donnees),
    boutiques: () => afficherBoutiques(donnees),
    categories: () => afficherCategories(donnees),
    apparence: () => afficherApparence(admin, donnees),
    livraisons: () => afficherLivraisons(admin, donnees),
  };
  const afficherOnglet = (nom, memoriser = false) => {
    const onglet = onglets[nom] ? nom : "tableau";
    if (memoriser) memoriserOnglet(onglet);
    document.querySelectorAll("[data-atab]").forEach((element) => element.classList.toggle("actif", element.dataset.atab === onglet));
    onglets[onglet]();
  };
  document.querySelectorAll("[data-atab]").forEach((button) => button.addEventListener("click", () => afficherOnglet(button.dataset.atab, true)));
  window.addEventListener("hashchange", () => afficherOnglet(ongletDepuisUrl(Object.keys(onglets), "tableau")));
  document.querySelectorAll("[data-fermer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  afficherOnglet(ongletDepuisUrl(Object.keys(onglets), "tableau"));
  rafraichirIcones(app);
}

function afficherTableau(donnees) {
  const zone = document.querySelector("#admin-zone");
  const gmv = donnees.commandes.filter((commande) => commande.statut !== "ANNULEE").reduce((total, commande) => total + Number(commande.total || 0), 0);
  const incidents = donnees.missions.filter((mission) => mission.statut === "ERREUR");
  const nouvelles = donnees.commandes.filter((commande) => commande.statut === "NOUVELLE");
  zone.innerHTML = `<div class="kpis"><div class="stat"><span class="muted petit">Utilisateurs</span><strong>${donnees.identitesCount}</strong></div><div class="stat"><span class="muted petit">Boutiques publiees</span><strong>${donnees.boutiques.filter((boutique) => boutique.statut === "PUBLIEE").length}</strong></div><div class="stat"><span class="muted petit">Commandes</span><strong>${donnees.commandes.length}</strong></div><div class="stat"><span class="muted petit">Volume de ventes</span><strong>${fcfa(gmv)}</strong></div></div><section class="section"><div class="entete-page"><div><h2>Activite recente</h2><p class="muted petit">Dernieres commandes de la plateforme</p></div>${nouvelles.length ? `<span class="badge badge-attention">${nouvelles.length} nouvelle${nouvelles.length > 1 ? "s" : ""}</span>` : ""}</div>${donnees.commandes.length ? `<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Boutique</th><th>Date</th><th>Total</th><th>Statut</th></tr></thead><tbody>${donnees.commandes.slice(0, 10).map((commande) => `<tr><td><strong>${escapeHtml(commande.reference)}</strong></td><td>${escapeHtml(commande.boutiques?.nom || "")}</td><td>${formatDate(commande.cree_le, true)}</td><td>${fcfa(commande.total)}</td><td>${badgeStatut(commande.statut)}</td></tr>`).join("")}</tbody></table></div>` : vide("package-open", "Aucune commande")}</section><section class="section"><div class="ligne-entre"><h2>Etat de la plateforme</h2>${incidents.length ? `<span class="badge badge-danger">${incidents.length} incident${incidents.length > 1 ? "s" : ""}</span>` : '<span class="badge badge-succes">Aucun incident</span>'}</div><div class="grille-deux" style="margin-top:14px"><div class="carte"><strong>${donnees.produitsCount}</strong><p class="muted petit" style="margin:5px 0 0">produits enregistres</p></div><div class="carte"><strong>${donnees.organisations.length}</strong><p class="muted petit" style="margin:5px 0 0">organisations actives ou suspendues</p></div></div></section>`;
  rafraichirIcones(zone);
}

function afficherTenants(admin, donnees) {
  const zone = document.querySelector("#admin-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Tenants et organisations</h2><p class="muted petit">L’offre Site dédié active une URL personnalisable pour chaque établissement.</p></div>${admin.role === "SUPER_ADMIN" ? `<button class="btn btn-primaire" id="nouveau-tenant">${icone("plus")} Nouveau tenant</button>` : ""}</div>${donnees.organisations.length ? `<div class="table-wrap"><table><thead><tr><th>Organisation</th><th>Type</th><th>Offre</th><th>Établissements</th><th>Membres</th><th>Etat</th><th></th></tr></thead><tbody>${donnees.organisations.map((organisation) => { const offre = Array.isArray(organisation.offres_organisations) ? organisation.offres_organisations[0] : organisation.offres_organisations; const nombre = donnees.boutiques.filter((boutique) => boutique.organisation_id === organisation.id).length; return `<tr><td><strong>${escapeHtml(organisation.nom)}</strong><p class="muted petit" style="margin:3px 0">${escapeHtml(organisation.slug)}</p></td><td><span class="badge">${escapeHtml(organisation.type)}</span></td><td>${badgeStatut(offre?.offre === "WHITE_LABEL" ? "ACTIF" : "STANDARD")}<span class="petit"> ${offre?.offre === "WHITE_LABEL" ? "Site dédié" : "Marketplace standard"}</span></td><td>${nombre} / ${Number(offre?.max_etablissements || 1)}</td><td>${organisation.membres_organisation?.filter((membre) => membre.statut === "ACTIF").length || 0}</td><td>${badgeStatut(organisation.actif ? "ACTIF" : "SUSPENDUE")}</td><td>${admin.role === "SUPER_ADMIN" ? `<button class="btn btn-secondaire" data-offre-organisation="${organisation.id}">${icone("settings")} Offre</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : vide("building-2", "Aucun tenant") }<div id="tenant-resultat" style="margin-top:15px"></div><section class="section"><h2>Equipe plateforme</h2><div class="pile">${donnees.administrateurs.map((administrateur) => `<div class="carte ligne-entre"><div><strong>${escapeHtml(`${administrateur.identites?.prenom || ""} ${administrateur.identites?.nom || ""}`.trim() || administrateur.identites?.email || "Administrateur")}</strong><p class="muted petit" style="margin:4px 0 0">${escapeHtml(administrateur.identites?.email || "")}</p></div><span class="badge">${escapeHtml(administrateur.role)}</span></div>`).join("")}</div></section>`;
  zone.querySelector("#nouveau-tenant")?.addEventListener("click", () => ouvrirTenant(donnees));
  zone.querySelectorAll("[data-offre-organisation]").forEach((button) => button.addEventListener("click", () => ouvrirOffreOrganisation(donnees, button.dataset.offreOrganisation)));
  rafraichirIcones(zone);
}

function ouvrirOffreOrganisation(donnees, organisationId) {
  const organisation = donnees.organisations.find((element) => element.id === organisationId);
  const offre = (Array.isArray(organisation.offres_organisations) ? organisation.offres_organisations[0] : organisation.offres_organisations) || { offre: "STANDARD", max_etablissements: 1 };
  document.querySelector("#admin-dialog-title").textContent = `Offre · ${organisation.nom}`;
  document.querySelector("#admin-dialog-zone").innerHTML = `<form id="offre-form"><div class="champ"><label>Type d'offre</label><select name="offre"><option value="STANDARD" ${offre.offre === "STANDARD" ? "selected" : ""}>Marketplace standard</option><option value="WHITE_LABEL" ${offre.offre === "WHITE_LABEL" ? "selected" : ""}>Site dédié</option></select></div><div class="champ"><label>Nombre maximal d’établissements</label><input name="max_etablissements" type="number" min="1" max="100" value="${Number(offre.max_etablissements || 1)}" required></div><label class="case"><input name="domaines_personnalises" type="checkbox" ${offre.domaines_personnalises ? "checked" : ""}> Autoriser les domaines personnalisés</label><div class="bande-info petit" style="margin:16px 0">Chaque établissement dispose de son propre thème, catalogue, panier et réglage IKMS.</div><button class="btn btn-primaire btn-bloc" id="sauver-offre">${icone("save")} Enregistrer l’offre</button></form>`;
  document.querySelector("#offre-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    const button = document.querySelector("#sauver-offre");
    boutonOccupe(button, true, "Enregistrement...");
    const { error } = await supabase.rpc("rpc_admin_definir_offre_organisation", {
      p_organisation_id: organisation.id,
      p_offre: valeurs.offre,
      p_max_etablissements: Number(valeurs.max_etablissements || 1),
      p_domaines_personnalises: new FormData(form).has("domaines_personnalises"),
    });
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Offre mise a jour");
    location.reload();
  });
  document.querySelector("#admin-dialog").showModal();
  rafraichirIcones(document.querySelector("#admin-dialog-zone"));
}

function normaliserTelephoneRamassage(valeur) {
  let telephone = String(valeur || "").replace(/\D/g, "");
  if (telephone.length === 13 && telephone.startsWith("225")) telephone = telephone.slice(3);
  return telephone;
}

async function ouvrirTenant(donnees) {
  document.querySelector("#admin-dialog-title").textContent = "Nouveau tenant";
  const dialogue = document.querySelector("#admin-dialog");
  const dialogueZone = document.querySelector("#admin-dialog-zone");
  dialogueZone.innerHTML = `<div class="squelette squelette-ligne squelette-titre"></div><div class="squelette squelette-panneau" style="min-height:340px"></div>`;
  dialogue.showModal();

  const catalogueZones = await chargerZonesIkms(donnees.configuration || etat.configuration);
  const optionsZones = (catalogueZones.zones || [])
    .map((zone) => `<option value="${escapeHtml(zone.code)}">${escapeHtml(zone.nom || zone.code)}</option>`)
    .join("");
  const champZone = `<select name="zone_depart" required><option value="">${optionsZones ? "Choisir une zone IKMS" : "Aucune zone IKMS disponible"}</option>${optionsZones}</select>`;
  const aideZone = catalogueZones.disponible
    ? "Liste synchronisee avec le catalogue IKMS et gardee en cache pendant une heure."
    : optionsZones
      ? "Catalogue IKMS hors ligne : la derniere liste disponible est utilisee."
      : "Configurez la cle du catalogue IKMS dans Administration > Livraisons avant de creer cette boutique.";

  dialogueZone.innerHTML = `<form id="tenant-form">
    <div class="champ"><label>Nom de l'organisation</label><input name="nom" required autocomplete="organization"></div>
    <div class="champ"><label>Identifiant</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required><span class="champ-aide">Lettres minuscules, chiffres et tirets.</span></div>
    <div class="champ"><label>Type</label><select name="type"><option value="MARCHAND">Marchand</option><option value="RESTAURANT">Restaurant</option><option value="PRESSING">Pressing</option><option value="LOGISTIQUE">Logistique</option><option value="AUTRE">Autre</option></select></div>
    <div class="champ"><label>Email du premier administrateur</label><input name="email" type="email" required autocomplete="email"></div>
    <label class="case"><input name="creer_boutique" type="checkbox" checked> Creer egalement la boutique pour les activites marchandes</label>
    <fieldset id="ramassage-tenant" class="carte" style="margin-top:16px">
      <legend class="legende">Ramassage habituel</legend>
      <div class="champ"><label>Zone de ramassage</label>${champZone}<span class="champ-aide">${escapeHtml(aideZone)}</span></div>
      <div class="grille-deux">
        <div class="champ"><label>Telephone de ramassage</label><input name="expediteur_tel" type="tel" inputmode="tel" placeholder="0700000000" required autocomplete="tel"></div>
        <div class="champ"><label>Adresse de ramassage</label><input name="expediteur_adresse" placeholder="Quartier, rue, repere" required autocomplete="street-address"></div>
      </div>
      <p class="muted petit" style="margin:0">Ces informations sont pre-enregistrees. Le marchand ajoutera ensuite sa propre cle API IKMS pour activer les transmissions.</p>
    </fieldset>
    <button class="btn btn-primaire btn-bloc" id="creer-tenant" style="margin-top:17px">${icone("building-2")} Creer et inviter</button>
  </form>`;
  const nom = document.querySelector('#tenant-form [name="nom"]');
  const slug = document.querySelector('#tenant-form [name="slug"]');
  const type = document.querySelector('#tenant-form [name="type"]');
  const creerBoutique = document.querySelector('#tenant-form [name="creer_boutique"]');
  const ramassage = document.querySelector("#ramassage-tenant");
  let modifie = false;
  slug.addEventListener("input", () => { modifie = true; });
  nom.addEventListener("input", () => { if (!modifie) slug.value = slugifier(nom.value); });
  const synchroniserRamassage = () => {
    const marchand = ["MARCHAND", "RESTAURANT"].includes(type.value);
    if (!marchand) creerBoutique.checked = false;
    creerBoutique.disabled = !marchand;
    const actif = marchand && creerBoutique.checked;
    ramassage.hidden = !actif;
    ramassage.querySelectorAll("input, select").forEach((champ) => {
      champ.disabled = !actif;
      champ.required = actif;
    });
  };
  type.addEventListener("change", synchroniserRamassage);
  creerBoutique.addEventListener("change", synchroniserRamassage);
  synchroniserRamassage();
  document.querySelector("#tenant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    const avecBoutique = new FormData(form).has("creer_boutique");
    const telephone = normaliserTelephoneRamassage(valeurs.expediteur_tel);
    if (avecBoutique && telephone.length !== 10) {
      toast("Le telephone de ramassage doit contenir 10 chiffres.", true);
      return;
    }
    const button = document.querySelector("#creer-tenant");
    boutonOccupe(button, true, "Creation...");
    const { data, error } = await supabase.rpc("rpc_admin_creer_tenant", {
      p_nom: valeurs.nom,
      p_slug: valeurs.slug,
      p_type: valeurs.type,
      p_email_proprietaire: valeurs.email,
      p_creer_boutique: avecBoutique,
    });
    if (error) {
      boutonOccupe(button, false);
      return gererErreur(error);
    }

    let ramassageInitialise = false;
    if (avecBoutique && data?.boutique_id) {
      boutonOccupe(button, true, "Ramassage...");
      const resultatRamassage = await supabase.rpc("rpc_configurer_integration_ikms_boutique", {
        p_boutique_id: data.boutique_id,
        p_zone_depart: String(valeurs.zone_depart || "").trim().toUpperCase(),
        p_expediteur_nom: String(valeurs.nom || "").trim(),
        p_expediteur_tel: telephone,
        p_expediteur_adresse: String(valeurs.expediteur_adresse || "").trim(),
        p_mode_paiement: "A_LA_LIVRAISON",
        p_api_key: null,
        p_actif: false,
      });
      ramassageInitialise = !resultatRamassage.error;
      if (resultatRamassage.error) {
        console.error("Initialisation du ramassage IKMS impossible", resultatRamassage.error);
      }
    }
    boutonOccupe(button, false);
    const lien = `${location.origin}${location.pathname.replace(/marketplace\/admin\.html$/, "identity/index.html")}?invitation=${data.token}`;
    await navigator.clipboard.writeText(lien).catch(() => null);
    dialogue.close();
    const confirmationRamassage = avecBoutique
      ? ramassageInitialise
        ? `<p class="petit" style="margin:6px 0 0">Ramassage pre-enregistre : ${escapeHtml(String(valeurs.zone_depart || "").toUpperCase())}, ${escapeHtml(valeurs.expediteur_adresse)}.</p>`
        : '<p class="petit" style="margin:6px 0 0;color:var(--danger)">Tenant cree, mais le ramassage doit etre complete dans l’espace marchand.</p>'
      : "";
    document.querySelector("#tenant-resultat").innerHTML = `<div class="bande-info"><strong>Tenant cree</strong><p class="petit" style="word-break:break-all;margin:6px 0">${escapeHtml(lien)}</p><p class="petit" style="margin:0">Le lien d'inscription a ete copie. Envoie-le a ${escapeHtml(valeurs.email)}.</p>${confirmationRamassage}</div>`;
    toast(ramassageInitialise || !avecBoutique ? "Tenant cree et lien copie" : "Tenant cree, ramassage a verifier", avecBoutique && !ramassageInitialise);
  });
  rafraichirIcones(dialogue);
}

function afficherBoutiques(donnees) {
  const zone = document.querySelector("#admin-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Boutiques</h2><p class="muted petit">Publication et moderation</p></div></div>${donnees.boutiques.length ? `<div class="table-wrap"><table><thead><tr><th>Boutique</th><th>Tenant</th><th>Note</th><th>Statut</th><th></th></tr></thead><tbody>${donnees.boutiques.map((boutique) => `<tr><td><strong>${escapeHtml(boutique.nom)}</strong><p class="muted petit" style="margin:3px 0">${escapeHtml(boutique.slug)}</p></td><td>${escapeHtml(boutique.organisations?.nom || "")}</td><td>${Number(boutique.note_moyenne || 0).toFixed(1)}</td><td>${badgeStatut(boutique.statut)}</td><td><button class="btn ${boutique.statut === "SUSPENDUE" ? "btn-secondaire" : "btn-danger"}" data-moderer="${boutique.id}">${icone(boutique.statut === "SUSPENDUE" ? "circle-check" : "ban")} ${boutique.statut === "SUSPENDUE" ? "Reactiver" : "Suspendre"}</button></td></tr>`).join("")}</tbody></table></div>` : vide("store", "Aucune boutique")}`;
  zone.querySelectorAll("[data-moderer]").forEach((button) => button.addEventListener("click", async () => {
    const boutique = donnees.boutiques.find((element) => element.id === button.dataset.moderer);
    const statut = boutique.statut === "SUSPENDUE" ? "PUBLIEE" : "SUSPENDUE";
    const { error } = await supabase.from("boutiques").update({ statut }).eq("id", boutique.id);
    if (error) return gererErreur(error);
    boutique.statut = statut;
    toast("Boutique mise a jour");
    afficherBoutiques(donnees);
  }));
  if (donnees.domaines.length) {
    zone.insertAdjacentHTML("beforeend", `<section class="section"><div class="entete-page"><div><h2>Domaines des Sites dédiés</h2><p class="muted petit">Vérification et choix du domaine principal.</p></div></div><div class="table-wrap"><table><thead><tr><th>Domaine</th><th>Établissement</th><th>Statut</th><th></th></tr></thead><tbody>${donnees.domaines.map((domaine) => `<tr><td><strong>${escapeHtml(domaine.domaine)}</strong>${domaine.principal ? '<p class="muted petit" style="margin:3px 0">Principal</p>' : ""}</td><td>${escapeHtml(domaine.boutiques?.nom || "")}</td><td>${badgeStatut(domaine.statut)}</td><td><button class="btn btn-secondaire" data-verifier-domaine="${domaine.id}" data-verifie="${domaine.statut === "VERIFIE"}">${domaine.statut === "VERIFIE" ? "Retirer la vérification" : "Vérifier et rendre principal"}</button></td></tr>`).join("")}</tbody></table></div></section>`);
    zone.querySelectorAll("[data-verifier-domaine]").forEach((button) => button.addEventListener("click", async () => {
      const verifie = button.dataset.verifie !== "true";
      const { error } = await supabase.rpc("rpc_admin_verifier_domaine_boutique", {
        p_domaine_id: button.dataset.verifierDomaine,
        p_verifie: verifie,
        p_principal: verifie,
      });
      if (error) return gererErreur(error);
      toast(verifie ? "Domaine vérifié" : "Vérification retirée");
      location.reload();
    }));
  }
  rafraichirIcones(zone);
}

function afficherCategories(donnees) {
  const zone = document.querySelector("#admin-zone");
  zone.innerHTML = `<div class="entete-page"><div><h2>Categories</h2><p class="muted petit">Organisation du catalogue public</p></div><button class="btn btn-primaire" id="nouvelle-categorie">${icone("plus")} Ajouter</button></div><div class="grille-deux">${donnees.categories.map((categorie) => `<article class="carte boutique-carte"><img class="boutique-logo" src="${escapeHtml(categorie.image_url || donnees.configuration.hero_image_url)}" alt=""><div><div class="ligne-entre"><h3>${escapeHtml(categorie.nom)}</h3>${badgeStatut(categorie.actif ? "ACTIF" : "SUSPENDUE")}</div><p class="muted petit">${escapeHtml(categorie.description || categorie.slug)}</p><button class="btn btn-secondaire" data-categorie="${categorie.id}">${icone("pencil")} Modifier</button></div></article>`).join("")}</div>`;
  const ouvrir = (categorie = {}) => {
    document.querySelector("#admin-dialog-title").textContent = categorie.id ? "Modifier la categorie" : "Nouvelle categorie";
    document.querySelector("#admin-dialog-zone").innerHTML = `<form id="categorie-form"><div class="champ"><label>Nom</label><input name="nom" value="${escapeHtml(categorie.nom)}" required></div><div class="champ"><label>Identifiant</label><input name="slug" value="${escapeHtml(categorie.slug)}" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></div><div class="champ"><label>Description</label><textarea name="description">${escapeHtml(categorie.description)}</textarea></div><div class="champ"><label>URL de l'image</label><input name="image_url" type="url" value="${escapeHtml(categorie.image_url)}"></div><div class="champ"><label>Ordre</label><input name="ordre" type="number" value="${categorie.ordre ?? 0}"></div><label class="case"><input name="actif" type="checkbox" ${categorie.actif !== false ? "checked" : ""}> Visible dans le catalogue</label><button class="btn btn-primaire btn-bloc" style="margin-top:17px">Enregistrer</button></form>`;
    document.querySelector("#categorie-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const valeurs = Object.fromEntries(new FormData(form));
      const payload = { nom: valeurs.nom, slug: valeurs.slug, description: valeurs.description || null, image_url: valeurs.image_url || null, ordre: Number(valeurs.ordre || 0), actif: new FormData(form).has("actif") };
      const requete = categorie.id ? supabase.from("categories_marketplace").update(payload).eq("id", categorie.id) : supabase.from("categories_marketplace").insert(payload);
      const { error } = await requete;
      if (error) return gererErreur(error);
      toast("Categorie enregistree");
      location.reload();
    });
    document.querySelector("#admin-dialog").showModal();
  };
  zone.querySelector("#nouvelle-categorie").addEventListener("click", () => ouvrir());
  zone.querySelectorAll("[data-categorie]").forEach((button) => button.addEventListener("click", () => ouvrir(donnees.categories.find((categorie) => categorie.id === button.dataset.categorie))));
  rafraichirIcones(zone);
}

function afficherApparence(admin, donnees) {
  const zone = document.querySelector("#admin-zone");
  const configuration = donnees.configuration;
  const imagesInitiales = [...new Set((Array.isArray(configuration.hero_images)
    ? configuration.hero_images
    : [configuration.hero_image_url]).filter(Boolean))].slice(0, 6);
  let imagesBandeau = [...imagesInitiales];
  let logoActuel = configuration.logo_url || null;

  zone.innerHTML = `<form class="carte" id="apparence-form"><h2>Identite visuelle du site</h2><p class="muted petit">Les changements sont appliques a toutes les pages publiques.</p><div class="champ"><label>Nom du site</label><input name="nom" value="${escapeHtml(configuration.nom)}" required></div><div class="champ"><label>Accroche principale</label><input name="slogan" value="${escapeHtml(configuration.slogan)}" required></div><div class="champ"><label>Description</label><textarea name="description">${escapeHtml(configuration.description)}</textarea></div><div class="grille-deux"><div class="champ"><label>Couleur principale</label><input name="couleur_primaire" type="color" value="${escapeHtml(configuration.couleur_primaire)}"></div><div class="champ"><label>Couleur du bandeau</label><input name="couleur_secondaire" type="color" value="${escapeHtml(configuration.couleur_secondaire)}"></div></div><div class="champ"><label>Couleur d'accent</label><input name="couleur_accent" type="color" value="${escapeHtml(configuration.couleur_accent)}"></div><div class="grille-deux"><div class="champ"><label>Email support</label><input name="email_support" type="email" value="${escapeHtml(configuration.email_support)}"></div><div class="champ"><label>Telephone support</label><input name="telephone_support" type="tel" value="${escapeHtml(configuration.telephone_support)}"></div></div><div class="grille-deux"><div class="champ"><label>Logo</label><input name="logo" type="file" accept="image/jpeg,image/png,image/webp"><div id="logo-apercu" class="apparence-logo"></div></div><div class="champ"><label>Images du bandeau (6 maximum)</label><input name="heroes" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="grille-deux"><div class="champ"><label>Cadrage</label><select name="hero_mode_affichage"><option value="CONTAIN" ${configuration.hero_mode_affichage !== "COVER" ? "selected" : ""}>Image entiere</option><option value="COVER" ${configuration.hero_mode_affichage === "COVER" ? "selected" : ""}>Remplir le bandeau</option></select></div><div class="champ"><label>Defilement (secondes)</label><input name="hero_defilement_secondes" type="number" min="3" max="15" value="${Number(configuration.hero_defilement_secondes || 6)}" required></div></div></div></div><div id="bandeau-apercus" class="galerie-bandeau-admin"></div><button class="btn btn-primaire" id="sauver-apparence" ${admin.role !== "SUPER_ADMIN" ? "disabled" : ""}>${icone("save")} Enregistrer</button></form>`;
  const rendreLogo = () => {
    const apercu = zone.querySelector("#logo-apercu");
    apercu.innerHTML = logoActuel
      ? `<div class="media-admin media-admin-logo"><img src="${escapeHtml(logoActuel)}" alt="Logo actuel"><button type="button" class="media-supprimer" id="supprimer-logo" aria-label="Supprimer le logo" title="Supprimer le logo">${icone("trash-2")}</button></div>`
      : '<span class="muted petit">Aucun logo personnalise</span>';
    apercu.querySelector("#supprimer-logo")?.addEventListener("click", () => {
      logoActuel = null;
      rendreLogo();
    });
    rafraichirIcones(apercu);
  };
  const rendreImagesBandeau = () => {
    const apercus = zone.querySelector("#bandeau-apercus");
    apercus.innerHTML = imagesBandeau.length
      ? imagesBandeau.map((url, index) => `<div class="media-admin media-admin-bandeau"><img src="${escapeHtml(url)}" alt="Image ${index + 1} du bandeau"><div class="media-admin-actions"><button type="button" data-deplacer-hero="${index}" data-direction="-1" aria-label="Deplacer l'image vers la gauche" ${index === 0 ? "disabled" : ""}>${icone("chevron-left")}</button><button type="button" data-deplacer-hero="${index}" data-direction="1" aria-label="Deplacer l'image vers la droite" ${index === imagesBandeau.length - 1 ? "disabled" : ""}>${icone("chevron-right")}</button><button type="button" class="media-supprimer" data-supprimer-hero="${index}" aria-label="Supprimer l'image" title="Supprimer l'image">${icone("trash-2")}</button></div></div>`).join("")
      : '<span class="muted petit">Aucune image dans le bandeau</span>';
    apercus.querySelectorAll("[data-supprimer-hero]").forEach((button) => button.addEventListener("click", () => {
      imagesBandeau.splice(Number(button.dataset.supprimerHero), 1);
      rendreImagesBandeau();
    }));
    apercus.querySelectorAll("[data-deplacer-hero]").forEach((button) => button.addEventListener("click", () => {
      const index = Number(button.dataset.deplacerHero);
      const destination = index + Number(button.dataset.direction);
      if (destination < 0 || destination >= imagesBandeau.length) return;
      [imagesBandeau[index], imagesBandeau[destination]] = [imagesBandeau[destination], imagesBandeau[index]];
      rendreImagesBandeau();
    }));
    rafraichirIcones(apercus);
  };
  rendreLogo();
  rendreImagesBandeau();
  zone.querySelector("#apparence-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#sauver-apparence");
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    const nouveauxMedias = [];
    try {
      const fichiersBandeau = [...form.elements.heroes.files];
      if (imagesBandeau.length + fichiersBandeau.length > 6) throw new Error("Le bandeau accepte 6 images maximum.");
      let logo = logoActuel;
      if (form.elements.logo.files[0]) {
        logo = await televerserImage(form.elements.logo.files[0], "plateforme/identite");
        nouveauxMedias.push(logo);
      }
      const imagesAjoutees = [];
      for (const fichier of fichiersBandeau) {
        const image = await televerserImage(fichier, "plateforme/bandeau");
        imagesAjoutees.push(image);
        nouveauxMedias.push(image);
      }
      const imagesFinales = [...imagesBandeau, ...imagesAjoutees];
      const payload = { nom: valeurs.nom, slogan: valeurs.slogan, description: valeurs.description, couleur_primaire: valeurs.couleur_primaire, couleur_secondaire: valeurs.couleur_secondaire, couleur_accent: valeurs.couleur_accent, email_support: valeurs.email_support || null, telephone_support: valeurs.telephone_support || null, logo_url: logo, hero_image_url: imagesFinales[0] || configuration.hero_image_url || configurationDefaut.hero_image_url, hero_images: imagesFinales, hero_defilement_secondes: Number(valeurs.hero_defilement_secondes), hero_mode_affichage: valeurs.hero_mode_affichage };
      const { error } = await supabase.from("configuration_marketplace").update(payload).eq("id", 1);
      if (error) throw error;
      const mediasRetires = imagesInitiales.filter((url) => !imagesFinales.includes(url));
      if (configuration.logo_url && configuration.logo_url !== logo) mediasRetires.push(configuration.logo_url);
      await Promise.allSettled(mediasRetires.map((url) => supprimerImageStockage(url)));
      Object.assign(etat.configuration, payload);
      appliquerTheme(etat.configuration);
      toast("Apparence mise a jour");
      location.reload();
    } catch (error) {
      await Promise.allSettled(nouveauxMedias.map((url) => supprimerImageStockage(url)));
      boutonOccupe(button, false);
      gererErreur(error);
    }
  });
  rafraichirIcones(zone);
}

function zonesVersTexte(zones) {
  return (Array.isArray(zones) ? zones : [])
    .map((zone) => `${zone.code || ""}|${zone.nom || zone.code || ""}`)
    .join("\n");
}

function lireZones(texte) {
  const uniques = new Map();
  String(texte || "").split(/\r?\n/).forEach((ligne) => {
    const [codeBrut, ...nomBrut] = ligne.split("|");
    const code = String(codeBrut || "").trim().toUpperCase();
    const nom = nomBrut.join("|").trim() || code;
    if (code) uniques.set(code, { code, nom });
  });
  return [...uniques.values()];
}

function normaliserUrlIkms(value) {
  const brut = String(value || "").trim().replace(/\/+$/, "");
  if (!brut) return null;
  let url;
  try {
    url = new URL(brut);
  } catch {
    throw new Error("URL IKMS invalide.");
  }
  if (url.protocol !== "https:") throw new Error("L'URL IKMS doit utiliser HTTPS.");
  if (url.pathname.includes("/rest/v1")) {
    throw new Error("URL IKMS incorrecte : utilise l'endpoint applicatif /functions/v1/api-v1, pas /rest/v1.");
  }
  if (!url.pathname.includes("/functions/v1/")) {
    throw new Error("URL IKMS incorrecte : renseigne l'URL de l'API IKMS, par exemple https://projet.supabase.co/functions/v1/api-v1.");
  }
  return url.href.replace(/\/+$/, "");
}

function afficherLivraisons(admin, donnees) {
  const zone = document.querySelector("#admin-zone");
  const configuration = donnees.configuration;
  const incidents = donnees.missions.filter((mission) => ["ERREUR", "A_ENVOYER"].includes(mission.statut));
  const lectureSeule = admin.role !== "SUPER_ADMIN" ? "disabled" : "";
  zone.innerHTML = `<div class="entete-page"><div><h2>Logistique et notifications</h2><p class="muted petit">Tenant IKMS, zones, emails et missions</p></div>${incidents.length ? `<span class="badge badge-danger">${incidents.length} a verifier</span>` : '<span class="badge badge-succes">Tout est normal</span>'}</div><div class="grille-deux"><form class="carte" id="ikms-plateforme-form"><h3>Tenant IKMS</h3><div class="grille-deux"><div class="champ"><label>Nom</label><input name="ikms_tenant_nom" value="${escapeHtml(configuration.ikms_tenant_nom)}" required ${lectureSeule}></div><div class="champ"><label>Code</label><input name="ikms_tenant_code" value="${escapeHtml(configuration.ikms_tenant_code)}" required ${lectureSeule}></div></div><div class="champ"><label>URL de base API</label><input name="ikms_api_base_url" type="url" value="${escapeHtml(configuration.ikms_api_base_url)}" placeholder="https://projet.supabase.co/functions/v1/api-v1" ${lectureSeule}></div><div class="champ"><label>Page de creation du compte pro</label><input name="ikms_portail_pro_url" type="url" value="${escapeHtml(configuration.ikms_portail_pro_url)}" placeholder="https://..." ${lectureSeule}></div><div class="grille-deux"><div class="champ"><label>Cle API pour le catalogue des zones</label><input name="ikms_catalogue_api_key" type="password" autocomplete="new-password" placeholder="${configuration.ikms_catalogue_cle_configuree ? "Laisser vide pour conserver la cle" : "ik_live_..."}" ${lectureSeule}><span class="champ-aide">Utilisee uniquement cote serveur pour GET /tarifs.</span></div><div class="champ"><label>Prix affiche « a partir de »</label><input name="livraison_a_partir_de" type="number" min="0" max="5000000" step="100" value="${Number(configuration.livraison_a_partir_de || 1000)}" ${lectureSeule}></div></div><div class="bande-info"><strong>Zones automatiques</strong><p class="petit" style="margin:5px 0 0">Les zones sont extraites de GET /tarifs et gardees en cache une heure. Il n'y a plus de liste a recopier manuellement.</p></div><button class="btn btn-primaire" id="sauver-ikms" ${lectureSeule}>${icone("save")} Enregistrer IKMS</button></form><form class="carte" id="email-transactionnel-form"><div class="ligne-entre"><h3>Emails de statut</h3>${badgeStatut(configuration.emails_transactionnels_actifs ? "ACTIF" : "SUSPENDUE")}</div><div class="champ"><label>Nom expediteur</label><input name="nom_expediteur" value="${escapeHtml(configuration.nom_expediteur_email)}" required ${lectureSeule}></div><div class="champ"><label>Email expediteur verifie</label><input name="email_expediteur" type="email" value="${escapeHtml(configuration.email_expediteur)}" required ${lectureSeule}></div><div class="champ"><label>URL publique</label><input name="site_public_url" type="url" value="${escapeHtml(configuration.site_public_url)}" required ${lectureSeule}></div><div class="champ"><label>Cle API Resend</label><input name="api_key" type="password" autocomplete="new-password" placeholder="${configuration.email_api_configuree ? "Laisser vide pour conserver la cle" : "re_..."}" ${lectureSeule}></div><label class="case"><input name="actif" type="checkbox" ${configuration.emails_transactionnels_actifs ? "checked" : ""} ${lectureSeule}> Envoyer uniquement les quatre jalons client</label><button class="btn btn-primaire" id="sauver-emails" style="margin-top:16px" ${lectureSeule}>${icone("mail-check")} Enregistrer les emails</button></form></div><section class="section"><div class="ligne-entre"><div><h3>Missions IKMS</h3><p class="muted petit">Synchronisation automatique toutes les deux minutes</p></div></div>${donnees.missions.length ? `<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Boutique</th><th>IKMS</th><th>Synchronisee</th><th>Tentatives</th><th>Statut</th><th>Erreur</th></tr></thead><tbody>${donnees.missions.map((mission) => `<tr><td><strong>${escapeHtml(mission.commandes_marketplace?.reference || mission.commande_id)}</strong></td><td>${escapeHtml(mission.commandes_marketplace?.boutiques?.nom || "")}</td><td><span class="petit">${escapeHtml(mission.commande_livraison_externe_id || "-")}<br>${escapeHtml(mission.statut_ikms || "-")}</span></td><td>${mission.derniere_synchronisation ? formatDate(mission.derniere_synchronisation, true) : "-"}</td><td>${mission.tentatives}</td><td>${badgeStatut(mission.statut)}</td><td class="muted petit">${escapeHtml(mission.derniere_erreur || "")}</td></tr>`).join("")}</tbody></table></div>` : vide("truck", "Aucune mission logistique", "Les missions apparaitront apres la transmission d'une commande prete.")}</section>`;
  zone.querySelector("#ikms-plateforme-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = zone.querySelector("#sauver-ikms");
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    let payload;
    try {
      payload = {
        p_ikms_tenant_nom: valeurs.ikms_tenant_nom.trim(),
        p_ikms_tenant_code: valeurs.ikms_tenant_code.trim().toUpperCase(),
        p_ikms_api_base_url: normaliserUrlIkms(valeurs.ikms_api_base_url),
        p_ikms_portail_pro_url: valeurs.ikms_portail_pro_url?.trim() || null,
        p_ikms_catalogue_api_key: valeurs.ikms_catalogue_api_key || null,
        p_livraison_a_partir_de: Number(valeurs.livraison_a_partir_de || 1000),
      };
    } catch (error) {
      return gererErreur(error);
    }
    boutonOccupe(button, true, "Enregistrement...");
    const { error } = await supabase.rpc("rpc_configurer_ikms_plateforme", payload);
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Configuration IKMS enregistree");
    location.reload();
  });
  zone.querySelector("#email-transactionnel-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = zone.querySelector("#sauver-emails");
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    const { error } = await supabase.rpc("rpc_configurer_email_transactionnel", {
      p_email_expediteur: valeurs.email_expediteur,
      p_nom_expediteur: valeurs.nom_expediteur,
      p_site_public_url: valeurs.site_public_url,
      p_api_key: valeurs.api_key || null,
      p_actif: new FormData(form).has("actif"),
    });
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    toast("Emails transactionnels enregistres");
    location.reload();
  });
  rafraichirIcones(zone);
}
