import {
  appliquerTheme,
  boutonOccupe,
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
    supabase.from("organisations").select("id, nom, slug, type, actif, cree_le, membres_organisation(identite_id, role, statut)").order("cree_le", { ascending: false }),
    supabase.from("boutiques").select("id, organisation_id, nom, slug, statut, note_moyenne, cree_le, organisations(nom, type)").order("cree_le", { ascending: false }),
    supabase.from("produits").select("id, boutique_id, statut", { count: "exact" }),
    supabase.from("commandes_marketplace").select("id, reference, boutique_id, statut, total, cree_le, boutiques(nom)").order("cree_le", { ascending: false }).limit(300),
    supabase.from("missions_logistiques").select("id, commande_id, statut, tentatives, derniere_erreur, cree_le, commandes_marketplace(reference, boutiques(nom))").order("cree_le", { ascending: false }).limit(100),
    supabase.from("categories_marketplace").select("*").order("ordre").order("nom"),
    supabase.from("configuration_marketplace").select("*").eq("id", 1).single(),
    supabase.from("administrateurs_plateforme").select("identite_id, role, actif, identites(prenom, nom, email)").order("cree_le"),
    supabase.from("identites").select("id", { count: "exact", head: true }),
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
  };
}

export async function rendreAdmin() {
  if (!etat.session) return demanderConnexion();
  coquille('<main class="conteneur"><div class="vide">Verification des droits...</div></main>', { mode: "gestion", espace: "Administration" });
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
    livraisons: () => afficherLivraisons(donnees),
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
  zone.innerHTML = `<div class="entete-page"><div><h2>Tenants et organisations</h2><p class="muted petit">Un tenant devient marchand lorsqu'une boutique lui est associee.</p></div>${admin.role === "SUPER_ADMIN" ? `<button class="btn btn-primaire" id="nouveau-tenant">${icone("plus")} Nouveau tenant</button>` : ""}</div>${donnees.organisations.length ? `<div class="table-wrap"><table><thead><tr><th>Organisation</th><th>Type</th><th>Membres</th><th>Creee le</th><th>Etat</th></tr></thead><tbody>${donnees.organisations.map((organisation) => `<tr><td><strong>${escapeHtml(organisation.nom)}</strong><p class="muted petit" style="margin:3px 0">${escapeHtml(organisation.slug)}</p></td><td><span class="badge">${escapeHtml(organisation.type)}</span></td><td>${organisation.membres_organisation?.filter((membre) => membre.statut === "ACTIF").length || 0}</td><td>${formatDate(organisation.cree_le)}</td><td>${badgeStatut(organisation.actif ? "ACTIF" : "SUSPENDUE")}</td></tr>`).join("")}</tbody></table></div>` : vide("building-2", "Aucun tenant") }<div id="tenant-resultat" style="margin-top:15px"></div><section class="section"><h2>Equipe plateforme</h2><div class="pile">${donnees.administrateurs.map((administrateur) => `<div class="carte ligne-entre"><div><strong>${escapeHtml(`${administrateur.identites?.prenom || ""} ${administrateur.identites?.nom || ""}`.trim() || administrateur.identites?.email || "Administrateur")}</strong><p class="muted petit" style="margin:4px 0 0">${escapeHtml(administrateur.identites?.email || "")}</p></div><span class="badge">${escapeHtml(administrateur.role)}</span></div>`).join("")}</div></section>`;
  zone.querySelector("#nouveau-tenant")?.addEventListener("click", () => ouvrirTenant(donnees));
  rafraichirIcones(zone);
}

function ouvrirTenant(donnees) {
  document.querySelector("#admin-dialog-title").textContent = "Nouveau tenant";
  document.querySelector("#admin-dialog-zone").innerHTML = `<form id="tenant-form"><div class="champ"><label>Nom de l'organisation</label><input name="nom" required></div><div class="champ"><label>Identifiant</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></div><div class="champ"><label>Type</label><select name="type"><option value="MARCHAND">Marchand</option><option value="RESTAURANT">Restaurant</option><option value="PRESSING">Pressing</option><option value="LOGISTIQUE">Logistique</option><option value="AUTRE">Autre</option></select></div><div class="champ"><label>Email du premier administrateur</label><input name="email" type="email" required></div><label class="case"><input name="creer_boutique" type="checkbox" checked> Creer egalement la boutique pour les activites marchandes</label><button class="btn btn-primaire btn-bloc" id="creer-tenant" style="margin-top:17px">${icone("building-2")} Creer et inviter</button></form>`;
  const nom = document.querySelector('#tenant-form [name="nom"]');
  const slug = document.querySelector('#tenant-form [name="slug"]');
  let modifie = false;
  slug.addEventListener("input", () => { modifie = true; });
  nom.addEventListener("input", () => { if (!modifie) slug.value = slugifier(nom.value); });
  document.querySelector("#tenant-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    const button = document.querySelector("#creer-tenant");
    boutonOccupe(button, true, "Creation...");
    const { data, error } = await supabase.rpc("rpc_admin_creer_tenant", {
      p_nom: valeurs.nom,
      p_slug: valeurs.slug,
      p_type: valeurs.type,
      p_email_proprietaire: valeurs.email,
      p_creer_boutique: new FormData(form).has("creer_boutique"),
    });
    boutonOccupe(button, false);
    if (error) return gererErreur(error);
    const lien = `${location.origin}${location.pathname.replace(/marketplace\/admin\.html$/, "identity/index.html")}?invitation=${data.token}`;
    await navigator.clipboard.writeText(lien).catch(() => null);
    document.querySelector("#admin-dialog").close();
    document.querySelector("#tenant-resultat").innerHTML = `<div class="bande-info"><strong>Tenant cree</strong><p class="petit" style="word-break:break-all;margin:6px 0">${escapeHtml(lien)}</p><p class="petit" style="margin:0">Le lien d'inscription a ete copie. Envoie-le a ${escapeHtml(valeurs.email)}.</p></div>`;
    toast("Tenant cree et lien copie");
  });
  rafraichirIcones(document.querySelector("#admin-dialog"));
  document.querySelector("#admin-dialog").showModal();
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
  zone.innerHTML = `<form class="carte" id="apparence-form"><h2>Identite visuelle du site</h2><p class="muted petit">Les changements sont appliques a toutes les pages publiques.</p><div class="champ"><label>Nom du site</label><input name="nom" value="${escapeHtml(configuration.nom)}" required></div><div class="champ"><label>Accroche principale</label><input name="slogan" value="${escapeHtml(configuration.slogan)}" required></div><div class="champ"><label>Description</label><textarea name="description">${escapeHtml(configuration.description)}</textarea></div><div class="grille-deux"><div class="champ"><label>Couleur principale</label><input name="couleur_primaire" type="color" value="${escapeHtml(configuration.couleur_primaire)}"></div><div class="champ"><label>Couleur du bandeau</label><input name="couleur_secondaire" type="color" value="${escapeHtml(configuration.couleur_secondaire)}"></div></div><div class="champ"><label>Couleur d'accent</label><input name="couleur_accent" type="color" value="${escapeHtml(configuration.couleur_accent)}"></div><div class="grille-deux"><div class="champ"><label>Email support</label><input name="email_support" type="email" value="${escapeHtml(configuration.email_support)}"></div><div class="champ"><label>Telephone support</label><input name="telephone_support" type="tel" value="${escapeHtml(configuration.telephone_support)}"></div></div><div class="grille-deux"><div class="champ"><label>Logo</label><input name="logo" type="file" accept="image/jpeg,image/png,image/webp">${configuration.logo_url ? `<img src="${escapeHtml(configuration.logo_url)}" alt="" style="width:90px;height:90px;object-fit:contain;border-radius:6px">` : ""}</div><div class="champ"><label>Image d'accueil</label><input name="hero" type="file" accept="image/jpeg,image/png,image/webp"><img src="${escapeHtml(configuration.hero_image_url)}" alt="" style="width:160px;height:90px;object-fit:cover;border-radius:6px"></div></div><button class="btn btn-primaire" id="sauver-apparence" ${admin.role !== "SUPER_ADMIN" ? "disabled" : ""}>${icone("save")} Enregistrer</button></form>`;
  zone.querySelector("#apparence-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.querySelector("#sauver-apparence");
    const form = event.currentTarget;
    const valeurs = Object.fromEntries(new FormData(form));
    boutonOccupe(button, true, "Enregistrement...");
    try {
      const logo = form.elements.logo.files[0] ? await televerserImage(form.elements.logo.files[0], "plateforme/identite") : configuration.logo_url;
      const hero = form.elements.hero.files[0] ? await televerserImage(form.elements.hero.files[0], "plateforme/identite") : configuration.hero_image_url;
      const payload = { nom: valeurs.nom, slogan: valeurs.slogan, description: valeurs.description, couleur_primaire: valeurs.couleur_primaire, couleur_secondaire: valeurs.couleur_secondaire, couleur_accent: valeurs.couleur_accent, email_support: valeurs.email_support || null, telephone_support: valeurs.telephone_support || null, logo_url: logo, hero_image_url: hero };
      const { error } = await supabase.from("configuration_marketplace").update(payload).eq("id", 1);
      if (error) throw error;
      Object.assign(etat.configuration, payload);
      appliquerTheme(etat.configuration);
      toast("Apparence mise a jour");
      location.reload();
    } catch (error) { boutonOccupe(button, false); gererErreur(error); }
  });
  rafraichirIcones(zone);
}

function afficherLivraisons(donnees) {
  const zone = document.querySelector("#admin-zone");
  const incidents = donnees.missions.filter((mission) => ["ERREUR", "A_ENVOYER"].includes(mission.statut));
  zone.innerHTML = `<div class="entete-page"><div><h2>Supervision logistique</h2><p class="muted petit">Missions transmises a Ikigai Livraison</p></div>${incidents.length ? `<span class="badge badge-danger">${incidents.length} a verifier</span>` : '<span class="badge badge-succes">Tout est normal</span>'}</div>${donnees.missions.length ? `<div class="table-wrap"><table><thead><tr><th>Commande</th><th>Boutique</th><th>Date</th><th>Tentatives</th><th>Statut</th><th>Derniere erreur</th></tr></thead><tbody>${donnees.missions.map((mission) => `<tr><td><strong>${escapeHtml(mission.commandes_marketplace?.reference || mission.commande_id)}</strong></td><td>${escapeHtml(mission.commandes_marketplace?.boutiques?.nom || "")}</td><td>${formatDate(mission.cree_le, true)}</td><td>${mission.tentatives}</td><td>${badgeStatut(mission.statut)}</td><td class="muted petit">${escapeHtml(mission.derniere_erreur || "")}</td></tr>`).join("")}</tbody></table></div>` : vide("truck", "Aucune mission logistique", "Les missions apparaitront quand une commande prete sera transmise.")}`;
  rafraichirIcones(zone);
}
