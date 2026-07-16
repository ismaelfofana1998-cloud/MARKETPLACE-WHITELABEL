import {
  boutonOccupe,
  escapeHtml,
  fcfa,
  formatDate,
  icone,
  imageProduit,
  lienRetour,
  memoriserOnglet,
  messageErreur,
  ongletDepuisUrl,
  rafraichirIcones,
  supabase,
  toast,
  urlConfirmationCourante,
  urlIdentity,
} from "../assets/api.js?v=9";
import {
  app,
  badgeStatut,
  boutiqueContexteId,
  brancherAjoutsPanier,
  brancherFavoris,
  carteProduit,
  coquille,
  etat,
  gererErreur,
  normaliserProduit,
  vide,
} from "./shared.js?v=9";

function rendreAuthentification() {
  const modeInitial = new URLSearchParams(location.search).get("mode") === "inscription" ? "inscription" : "connexion";
  coquille(`<main class="conteneur conteneur-etroit"><div class="auth-form" style="margin:28px auto"><div class="entete-page"><div><h1>Mon compte</h1><p class="muted">Commandes, adresses et favoris</p></div></div><div class="onglets"><button class="onglet" data-auth="connexion">Connexion</button><button class="onglet" data-auth="inscription">Creer un compte</button></div><div id="auth-zone" style="padding-top:20px"></div></div></main>`, { actif: "compte" });

  const afficher = (mode) => {
    document.querySelectorAll("[data-auth]").forEach((button) => button.classList.toggle("actif", button.dataset.auth === mode));
    const inscription = mode === "inscription";
    document.querySelector("#auth-zone").innerHTML = `<form id="auth-form">
      ${inscription ? '<div class="grille-deux"><div class="champ"><label>Prenom</label><input name="prenom" autocomplete="given-name" required></div><div class="champ"><label>Nom</label><input name="nom" autocomplete="family-name" required></div></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" autocomplete="tel"></div>' : ""}
      <div class="champ"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
      <div class="champ"><label>Mot de passe</label><input name="password" type="password" minlength="8" autocomplete="${inscription ? "new-password" : "current-password"}" required><span class="champ-aide">8 caracteres minimum</span></div>
      <button class="btn btn-primaire btn-bloc" id="auth-submit">${icone(inscription ? "user-plus" : "log-in")} ${inscription ? "Creer mon compte" : "Se connecter"}</button>
    </form>${!inscription ? '<button class="btn btn-texte" id="mot-de-passe-oublie" style="margin-top:10px">Mot de passe oublie</button>' : '<p class="muted petit" style="margin-top:13px">Un email de confirmation peut etre demande selon les reglages Supabase.</p>'}`;
    rafraichirIcones(document.querySelector("#auth-zone"));
    document.querySelector("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      const button = document.querySelector("#auth-submit");
      boutonOccupe(button, true, inscription ? "Creation..." : "Connexion...");
      const resultat = inscription
        ? await supabase.auth.signUp({
            email: valeurs.email.trim(),
            password: valeurs.password,
            options: { emailRedirectTo: urlConfirmationCourante(), data: { prenom: valeurs.prenom.trim(), nom: valeurs.nom.trim(), telephone: valeurs.telephone?.trim() || null } },
          })
        : await supabase.auth.signInWithPassword({ email: valeurs.email.trim(), password: valeurs.password });
      boutonOccupe(button, false);
      if (resultat.error) return gererErreur(resultat.error);
      if (!resultat.data.session) return toast("Compte cree. Confirme ton email pour te connecter.");
      const retour = lienRetour("");
      if (retour) location.href = retour;
      else location.reload();
    });
    document.querySelector("#mot-de-passe-oublie")?.addEventListener("click", async () => {
      const email = document.querySelector('[name="email"]').value.trim();
      if (!email) return toast("Saisis d'abord ton email.", true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: urlIdentity("recuperation") });
      error ? gererErreur(error) : toast("Lien de reinitialisation envoye");
    });
  };
  document.querySelectorAll("[data-auth]").forEach((button) => button.addEventListener("click", () => afficher(button.dataset.auth)));
  afficher(modeInitial);
}

async function chargerCompte() {
  let achatsRequete = supabase.from("achats")
    .select("id, boutique_contexte_id, reference, statut_paiement, mode_paiement, sous_total, frais_livraison, total, cree_le, adresses_livraison(libelle, destinataire_nom, telephone, adresse, commune, indications, code_zone), commandes_marketplace(id, reference, statut, sous_total, frais_livraison, total, note_client, motif_annulation, cree_le, boutiques(id, nom, logo_url), lignes_commande_marketplace(id, nom_produit, nom_variante, image_url, prix_unitaire, quantite), historique_statuts_commande(ancien_statut, nouveau_statut, source, cree_le), missions_logistiques(statut, statut_ikms, commande_livraison_externe_id, code_livraison, derniere_synchronisation, derniere_erreur))")
    .eq("acheteur_id", etat.session.user.id)
    .order("cree_le", { ascending: false });
  if (boutiqueContexteId()) achatsRequete = achatsRequete.eq("boutique_contexte_id", boutiqueContexteId());
  const [profil, achats, adresses, favoris, liens, administrateur] = await Promise.all([
    supabase.from("identites").select("*").eq("id", etat.session.user.id).single(),
    achatsRequete,
    supabase.from("adresses_livraison").select("*").eq("identite_id", etat.session.user.id).order("principale", { ascending: false }).order("cree_le", { ascending: false }),
    supabase.from("favoris_marketplace").select("produit_id, produits(id, boutique_id, categorie_id, nom, slug, description, marque, prix, prix_barre, images, statut, cree_le, boutiques(id, nom, slug, logo_url, statut), variantes_produit(id, nom, prix, actif, stocks(quantite)), avis_produits(note))").eq("identite_id", etat.session.user.id),
    supabase.from("membres_organisation").select("role, statut, organisations(id, nom, type)").eq("identite_id", etat.session.user.id).eq("statut", "ACTIF"),
    supabase.from("administrateurs_plateforme").select("role, actif").eq("identite_id", etat.session.user.id).eq("actif", true).maybeSingle(),
  ]);
  const erreurs = [profil.error, achats.error, adresses.error, favoris.error, liens.error, administrateur.error].filter(Boolean);
  if (erreurs.length) throw erreurs[0];
  return {
    profil: profil.data || {},
    achats: achats.data || [],
    adresses: adresses.data || [],
    favoris: (favoris.data || []).map((favori) => favori.produits).filter(Boolean).map(normaliserProduit)
      .filter((produit) => !boutiqueContexteId() || produit.boutique_id === boutiqueContexteId()),
    organisations: (liens.data || []).map((lien) => ({ ...lien.organisations, role: lien.role })),
    administrateur: administrateur.data || null,
  };
}

function carteCommande(achat) {
  const commandes = achat.commandes_marketplace || [];
  const statut = commandes.every((commande) => commande.statut === "LIVREE")
    ? "LIVREE"
    : commandes.every((commande) => commande.statut === "ANNULEE")
      ? "ANNULEE"
      : commandes.some((commande) => commande.statut === "EN_LIVRAISON")
        ? "EN_LIVRAISON"
        : commandes[0]?.statut || "NOUVELLE";
  return `<article class="carte"><div class="ligne-entre"><div><p class="muted petit">${formatDate(achat.cree_le)} - ${commandes.length} boutique${commandes.length > 1 ? "s" : ""}</p><h3>${escapeHtml(achat.reference)}</h3></div>${badgeStatut(statut)}</div><div class="ligne-entre" style="margin-top:14px"><div><strong>${fcfa(achat.total)}</strong><p class="muted petit" style="margin:3px 0 0">${achat.mode_paiement === "A_LA_LIVRAISON" ? "Paiement a la livraison" : escapeHtml(achat.mode_paiement)}</p></div><button class="btn btn-secondaire" data-detail-achat="${achat.id}">${icone("eye")} Details</button></div></article>`;
}

export async function rendreCompte() {
  if (!etat.session) { rendreAuthentification(); return; }
  const retourConnexion = lienRetour("");
  if (retourConnexion) {
    const cible = new URL(retourConnexion, location.href);
    const pageCompte = new URL(location.href);
    pageCompte.searchParams.delete("retour");
    if (cible.href !== pageCompte.href) {
      location.replace(cible.href);
      return;
    }
    history.replaceState({}, "", pageCompte);
  }
  coquille('<main class="conteneur"><div class="vide">Chargement du compte...</div></main>', { actif: "compte" });
  try {
    await supabase.functions.invoke("sync-livraisons", { body: {} }).catch(() => null);
    const donnees = await chargerCompte();
    const zones = Array.isArray(etat.configuration.zones_livraison) ? etat.configuration.zones_livraison : [];
    const optionsZones = (selection = "") => `${selection && !zones.some((zone) => zone.code === selection) ? `<option value="${escapeHtml(selection)}" selected>${escapeHtml(selection)}</option>` : ""}${zones.map((zone) => `<option value="${escapeHtml(zone.code)}" ${zone.code === selection ? "selected" : ""}>${escapeHtml(zone.nom || zone.code)}</option>`).join("")}`;
    const prenom = donnees.profil.prenom || etat.session.user.email.split("@")[0];
    coquille(`<main class="conteneur"><div class="entete-page"><div><h1>Bonjour ${escapeHtml(prenom)}</h1><p class="muted">${escapeHtml(etat.session.user.email)}</p></div><button class="btn btn-secondaire" id="deconnexion">${icone("log-out")} Deconnexion</button></div><div class="onglets" id="compte-tabs"><button class="onglet actif" data-tab="commandes">Commandes</button><button class="onglet" data-tab="profil">Profil</button><button class="onglet" data-tab="adresses">Adresses</button><button class="onglet" data-tab="favoris">Favoris</button><button class="onglet" data-tab="pro">Espace pro</button>${donnees.administrateur ? '<a class="onglet" href="./admin.html">Administration</a>' : ""}</div><section class="section" id="compte-zone"></section></main><dialog class="dialogue" id="detail-dialog"><div class="dialogue-entete"><h2>Detail de la commande</h2><button class="dialogue-fermer" data-fermer aria-label="Fermer">${icone("x")}</button></div><div class="dialogue-corps" id="detail-zone"></div></dialog>`, { actif: "compte" });
    const zone = document.querySelector("#compte-zone");
    const afficherCommandes = () => {
      zone.innerHTML = donnees.achats.length ? `<div class="pile">${donnees.achats.map(carteCommande).join("")}</div>` : vide("package-open", "Aucune commande", "Tes prochaines commandes apparaitront ici.", '<a class="btn btn-primaire" href="./index.html">Decouvrir le catalogue</a>');
      zone.querySelectorAll("[data-detail-achat]").forEach((button) => button.addEventListener("click", () => ouvrirDetail(button.dataset.detailAchat)));
      rafraichirIcones(zone);
    };
    const ouvrirDetail = (achatId) => {
      const achat = donnees.achats.find((element) => element.id === achatId);
      const commandes = achat.commandes_marketplace || [];
      const contenuCommandes = commandes.map((commande) => {
        const mission = Array.isArray(commande.missions_logistiques) ? commande.missions_logistiques[0] : commande.missions_logistiques;
        const historique = [...(commande.historique_statuts_commande || [])].sort((a, b) => new Date(a.cree_le) - new Date(b.cree_le));
        return `<section class="carte"><div class="ligne-entre"><div><p class="muted petit">${escapeHtml(commande.boutiques?.nom || "Boutique")}</p><strong>${escapeHtml(commande.reference)}</strong></div>${badgeStatut(commande.statut)}</div><div class="pile" style="margin-top:13px">${(commande.lignes_commande_marketplace || []).map((ligne) => `<div class="ligne"><img src="${escapeHtml(ligne.image_url || etat.configuration.hero_image_url)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:5px"><div style="flex:1"><strong class="petit">${escapeHtml(ligne.nom_produit)}</strong><p class="muted petit" style="margin:3px 0">${ligne.quantite} x ${fcfa(ligne.prix_unitaire)}</p></div></div>`).join("")}</div>${mission ? `<div class="bande-info" style="margin-top:13px"><div class="ligne-entre"><strong>Suivi IKIGAI Livraison</strong>${badgeStatut(mission.statut)}</div><p class="petit" style="margin:6px 0 0">${escapeHtml(mission.commande_livraison_externe_id || "Mission en creation")}${mission.statut_ikms ? ` - ${escapeHtml(mission.statut_ikms)}` : ""}${mission.code_livraison ? `<br>Code de livraison : <strong>${escapeHtml(mission.code_livraison)}</strong>` : ""}</p></div>` : ""}${historique.length ? `<div style="margin-top:14px"><strong class="petit">Historique</strong><div class="pile" style="margin-top:8px">${historique.map((etape) => `<div class="ligne-entre petit"><span>${escapeHtml(etape.nouveau_statut).replaceAll("_", " ")}</span><span class="muted">${formatDate(etape.cree_le, true)}</span></div>`).join("")}</div></div>` : ""}<div class="ligne-entre" style="margin-top:13px"><strong>${fcfa(commande.total)}</strong>${["NOUVELLE", "CONFIRMEE"].includes(commande.statut) ? `<button class="btn btn-danger" data-annuler="${commande.id}">${icone("x-circle")} Annuler</button>` : ""}</div>${commande.motif_annulation ? `<p class="petit muted" style="margin:10px 0 0">Motif : ${escapeHtml(commande.motif_annulation)}</p>` : ""}</section>`;
      }).join("");
      document.querySelector("#detail-zone").innerHTML = `<div class="ligne-entre"><div><p class="muted petit">${formatDate(achat.cree_le, true)}</p><h3>${escapeHtml(achat.reference)}</h3></div><strong>${fcfa(achat.total)}</strong></div><hr class="separateur"><div class="pile">${contenuCommandes}</div><hr class="separateur"><div><strong>Livraison</strong><p class="muted petit" style="margin:5px 0 0">${escapeHtml(achat.adresses_livraison?.destinataire_nom || "")} - ${escapeHtml(achat.adresses_livraison?.telephone || "")}<br>${escapeHtml(achat.adresses_livraison?.adresse || "")} ${escapeHtml(achat.adresses_livraison?.commune || "")}<br>Zone : ${escapeHtml(achat.adresses_livraison?.code_zone || "Non renseignee")}</p></div>`;
      document.querySelectorAll("[data-annuler]").forEach((button) => button.addEventListener("click", async () => {
        const motif = prompt("Motif de l'annulation (facultatif)") || null;
        const { error } = await supabase.rpc("rpc_annuler_commande_client", { p_commande_id: button.dataset.annuler, p_motif: motif });
        if (error) return gererErreur(error);
        await supabase.functions.invoke("sync-livraisons", { body: { commande_id: button.dataset.annuler, notifications_uniquement: true } });
        toast("Commande annulee et stock restitue");
        location.reload();
      }));
      rafraichirIcones(document.querySelector("#detail-zone"));
      document.querySelector("#detail-dialog").showModal();
    };
    const afficherProfil = () => {
      zone.innerHTML = `<form class="carte" id="profil-form"><h2>Mes informations</h2><div class="grille-deux"><div class="champ"><label>Prenom</label><input name="prenom" value="${escapeHtml(donnees.profil.prenom)}" autocomplete="given-name"></div><div class="champ"><label>Nom</label><input name="nom" value="${escapeHtml(donnees.profil.nom)}" autocomplete="family-name"></div></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" value="${escapeHtml(donnees.profil.telephone)}" autocomplete="tel"></div><button class="btn btn-primaire" id="enregistrer-profil">${icone("save")} Enregistrer</button></form>`;
      zone.querySelector("#profil-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const valeurs = Object.fromEntries(new FormData(event.currentTarget));
        const { error } = await supabase.from("identites").update(valeurs).eq("id", etat.session.user.id);
        if (error) return gererErreur(error);
        Object.assign(donnees.profil, valeurs);
        toast("Profil enregistre");
      });
      rafraichirIcones(zone);
    };
    const formulaireAdresse = (adresse = {}) => `<form class="carte" id="adresse-form"><h2>${adresse.id ? "Modifier l'adresse" : "Nouvelle adresse"}</h2><input type="hidden" name="id" value="${escapeHtml(adresse.id)}"><div class="grille-deux"><div class="champ"><label>Libelle</label><input name="libelle" value="${escapeHtml(adresse.libelle || "Domicile")}" required></div><div class="champ"><label>Destinataire</label><input name="destinataire_nom" value="${escapeHtml(adresse.destinataire_nom || `${donnees.profil.prenom || ""} ${donnees.profil.nom || ""}`.trim())}" required></div></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" value="${escapeHtml(adresse.telephone || donnees.profil.telephone)}" required></div><div class="champ"><label>Adresse</label><input name="adresse" value="${escapeHtml(adresse.adresse)}" required></div><div class="grille-deux"><div class="champ"><label>Commune</label><input name="commune" value="${escapeHtml(adresse.commune)}"></div><div class="champ"><label>Zone de livraison</label>${zones.length ? `<select name="code_zone" required><option value="">Choisir une zone</option>${optionsZones(adresse.code_zone || "")}</select>` : `<input name="code_zone" value="${escapeHtml(adresse.code_zone)}" placeholder="COCODY" required>`}</div></div><div class="champ"><label>Indications</label><textarea name="indications">${escapeHtml(adresse.indications)}</textarea></div><label class="case"><input type="checkbox" name="principale" ${adresse.principale ? "checked" : ""}> Adresse principale</label><button class="btn btn-primaire" style="margin-top:16px">${icone("save")} Enregistrer</button></form>`;
    const afficherAdresses = () => {
      zone.innerHTML = `<div class="entete-page"><div><h2>Mes adresses</h2><p class="muted petit">Utilisees pour pre-remplir la commande</p></div><button class="btn btn-primaire" id="ajouter-adresse">${icone("plus")} Ajouter</button></div><div class="grille-deux">${donnees.adresses.map((adresse) => `<article class="carte"><div class="ligne-entre"><div><h3>${escapeHtml(adresse.libelle)}</h3>${adresse.principale ? '<span class="badge badge-succes">Principale</span>' : ""}</div><div class="ligne"><button class="btn btn-texte" data-editer-adresse="${adresse.id}" aria-label="Modifier">${icone("pencil")}</button><button class="btn btn-texte" data-supprimer-adresse="${adresse.id}" aria-label="Supprimer">${icone("trash-2")}</button></div></div><p class="muted petit" style="margin:12px 0 0">${escapeHtml(adresse.destinataire_nom)} - ${escapeHtml(adresse.telephone)}<br>${escapeHtml(adresse.adresse)} ${escapeHtml(adresse.commune || "")}<br>Zone : ${escapeHtml(adresse.code_zone || "A completer")}</p></article>`).join("") || vide("map-pin", "Aucune adresse")}</div><div id="adresse-form-zone" style="margin-top:16px"></div>`;
      const ouvrirFormulaire = (adresse) => {
        zone.querySelector("#adresse-form-zone").innerHTML = formulaireAdresse(adresse);
        zone.querySelector("#adresse-form").addEventListener("submit", async (event) => {
          event.preventDefault();
          const valeurs = Object.fromEntries(new FormData(event.currentTarget));
          const id = valeurs.id;
          delete valeurs.id;
          valeurs.identite_id = etat.session.user.id;
          valeurs.code_zone = String(valeurs.code_zone || "").trim().toUpperCase();
          valeurs.principale = new FormData(event.currentTarget).has("principale");
          if (valeurs.principale) await supabase.from("adresses_livraison").update({ principale: false }).eq("identite_id", etat.session.user.id);
          const requete = id ? supabase.from("adresses_livraison").update(valeurs).eq("id", id) : supabase.from("adresses_livraison").insert(valeurs);
          const { error } = await requete;
          if (error) return gererErreur(error);
          toast("Adresse enregistree");
          location.reload();
        });
        rafraichirIcones(zone.querySelector("#adresse-form-zone"));
      };
      zone.querySelector("#ajouter-adresse").addEventListener("click", () => ouvrirFormulaire({}));
      zone.querySelectorAll("[data-editer-adresse]").forEach((button) => button.addEventListener("click", () => ouvrirFormulaire(donnees.adresses.find((adresse) => adresse.id === button.dataset.editerAdresse))));
      zone.querySelectorAll("[data-supprimer-adresse]").forEach((button) => button.addEventListener("click", async () => {
        if (!confirm("Supprimer cette adresse ?")) return;
        const { error } = await supabase.from("adresses_livraison").delete().eq("id", button.dataset.supprimerAdresse);
        if (error) return gererErreur(error);
        location.reload();
      }));
      rafraichirIcones(zone);
    };
    const afficherFavoris = () => {
      const idsFavoris = new Set(donnees.favoris.map((element) => element.id));
      zone.innerHTML = donnees.favoris.length ? `<div class="grille-produits">${donnees.favoris.map((produit) => carteProduit(produit, idsFavoris)).join("")}</div>` : vide("heart", "Aucun favori", "Enregistre les articles que tu souhaites retrouver rapidement.");
      brancherAjoutsPanier(zone);
      brancherFavoris(zone, idsFavoris);
      rafraichirIcones(zone);
    };
    const afficherPro = () => {
      const marchandes = donnees.organisations.filter((organisation) => ["MARCHAND", "RESTAURANT"].includes(organisation.type));
      zone.innerHTML = `<div class="grille-deux">${donnees.administrateur ? `<article class="carte"><h2>Administration plateforme</h2><p class="muted">Pilotage des tenants, boutiques, commandes, livraisons et de l'apparence.</p><a class="btn btn-primaire" href="./admin.html">${icone("shield-check")} Ouvrir l'administration</a></article>` : ""}<article class="carte"><h2>Espace marchand</h2><p class="muted">${marchandes.length ? `Tu as acces a ${marchandes.length} organisation${marchandes.length > 1 ? "s" : ""} marchande${marchandes.length > 1 ? "s" : ""}.` : "Cree ta boutique, ajoute tes articles et traite les commandes de ton equipe."}</p><a class="btn btn-primaire" href="./marchand.html">${icone("store")} ${marchandes.length ? "Ouvrir l'espace marchand" : "Creer ma boutique"}</a></article><article class="carte"><h2>Identite et equipe</h2><p class="muted">Gere tes organisations, tes salaries et leurs roles depuis IKIGAI Identity.</p><a class="btn btn-secondaire" href="../identity/index.html">${icone("users")} Gerer mes organisations</a></article></div>`;
      rafraichirIcones(zone);
    };
    const affichages = { commandes: afficherCommandes, profil: afficherProfil, adresses: afficherAdresses, favoris: afficherFavoris, pro: afficherPro };
    const afficherOnglet = (nom, memoriser = false) => {
      const onglet = affichages[nom] ? nom : "commandes";
      if (memoriser) memoriserOnglet(onglet);
      document.querySelectorAll("[data-tab]").forEach((element) => element.classList.toggle("actif", element.dataset.tab === onglet));
      affichages[onglet]();
    };
    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => afficherOnglet(button.dataset.tab, true)));
    window.addEventListener("hashchange", () => afficherOnglet(ongletDepuisUrl(Object.keys(affichages), "commandes")));
    document.querySelector("#deconnexion").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
    document.querySelectorAll("[data-fermer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
    afficherOnglet(ongletDepuisUrl(Object.keys(affichages), "commandes"));
    if (new URLSearchParams(location.search).has("commande") && donnees.achats.length) ouvrirDetail(new URLSearchParams(location.search).get("commande"));
    rafraichirIcones(app);
  } catch (error) {
    coquille(`<main class="conteneur">${vide("triangle-alert", "Compte indisponible", messageErreur(error))}</main>`, { actif: "compte" });
  }
}
