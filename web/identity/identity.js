import {
  appliquerTheme,
  boutonOccupe,
  chargerConfiguration,
  configurationManquante,
  escapeHtml,
  icone,
  memoriserOnglet,
  messageErreur,
  ongletDepuisUrl,
  rafraichirIcones,
  slugifier,
  supabase,
  toast,
  urlConfirmationCourante,
  urlIdentity,
} from "../assets/api.js?v=10";

const app = document.querySelector("#identity-app");
const etat = {
  session: null,
  identite: {},
  organisations: [],
  active: null,
  onglet: "profil",
  configuration: null,
};

function erreur(error) {
  toast(messageErreur(error), true);
}

async function chargerDonnees() {
  const { data: sessionData } = await supabase.auth.getSession();
  etat.session = sessionData.session;
  if (!etat.session) return;
  const [profil, liens] = await Promise.all([
    supabase.from("identites").select("*").eq("id", etat.session.user.id).single(),
    supabase.from("membres_organisation").select("organisation_id, role, statut, organisations(id, nom, slug, type, logo_url, actif)").eq("identite_id", etat.session.user.id).eq("statut", "ACTIF"),
  ]);
  if (profil.error) throw profil.error;
  if (liens.error) throw liens.error;
  etat.identite = profil.data || {};
  etat.organisations = (liens.data || []).map((lien) => ({ ...lien.organisations, role: lien.role }));
  etat.active = etat.organisations.find((organisation) => organisation.id === etat.identite.organisation_active_id) || etat.organisations[0] || null;
}

async function accepterInvitation() {
  const token = new URLSearchParams(location.search).get("invitation");
  if (!token || !etat.session) return;
  const { error: invitationErreur } = await supabase.rpc("rpc_accepter_invitation", { p_token: token });
  if (invitationErreur) {
    erreur(invitationErreur);
    return;
  }
  history.replaceState({}, "", location.pathname);
  toast("Invitation acceptee");
  await chargerDonnees();
}

function rendreAuth(modeInitial = "connexion") {
  app.innerHTML = `<div class="auth-shell"><section class="auth-visuel"><a class="marque" href="../marketplace/index.html"><span style="color:white">IKIGAI</span> <span>Identity</span></a><div><h1>Un compte pour tout l'ecosysteme IKIGAI.</h1><p>Marketplace, livraison et services professionnels partagent votre identite, sans melanger les donnees metier.</p></div><p class="auth-bas petit">IKIGAI Software</p></section><section class="auth-panneau"><div class="auth-form">${new URLSearchParams(location.search).has("invitation") ? '<div class="bande-info" style="margin-bottom:17px"><strong>Invitation recue</strong><p class="petit" style="margin:5px 0 0">Connecte-toi ou cree ton compte avec l\'email invite pour rejoindre l\'organisation.</p></div>' : ""}<div class="onglets"><button class="onglet" data-auth="connexion">Connexion</button><button class="onglet" data-auth="inscription">Creer un compte</button></div><div id="auth-zone" style="padding-top:21px"></div></div></section></div>`;
  const afficher = (mode) => {
    const inscription = mode === "inscription";
    document.querySelectorAll("[data-auth]").forEach((button) => button.classList.toggle("actif", button.dataset.auth === mode));
    document.querySelector("#auth-zone").innerHTML = `<form id="auth-form">${inscription ? '<div class="grille-deux"><div class="champ"><label>Prenom</label><input name="prenom" required></div><div class="champ"><label>Nom</label><input name="nom" required></div></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel"></div>' : ""}<div class="champ"><label>Email</label><input name="email" type="email" autocomplete="email" required></div><div class="champ"><label>Mot de passe</label><input name="password" type="password" minlength="8" autocomplete="${inscription ? "new-password" : "current-password"}" required></div><button class="btn btn-primaire btn-bloc" id="auth-submit">${icone(inscription ? "user-plus" : "log-in")} ${inscription ? "Creer mon compte" : "Se connecter"}</button></form>${!inscription ? '<button class="btn btn-texte" id="oublie" style="margin-top:10px">Mot de passe oublie</button>' : ""}`;
    document.querySelector("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      const button = document.querySelector("#auth-submit");
      boutonOccupe(button, true, inscription ? "Creation..." : "Connexion...");
      const resultat = inscription
        ? await supabase.auth.signUp({ email: valeurs.email.trim(), password: valeurs.password, options: { emailRedirectTo: urlConfirmationCourante(), data: { prenom: valeurs.prenom.trim(), nom: valeurs.nom.trim(), telephone: valeurs.telephone?.trim() || null } } })
        : await supabase.auth.signInWithPassword({ email: valeurs.email.trim(), password: valeurs.password });
      boutonOccupe(button, false);
      if (resultat.error) return erreur(resultat.error);
      if (!resultat.data.session) return toast("Compte cree. Confirme ton email avant de revenir sur ce lien.");
      await chargerDonnees();
      await accepterInvitation();
      rendreDashboard();
    });
    document.querySelector("#oublie")?.addEventListener("click", async () => {
      const email = document.querySelector('[name="email"]').value.trim();
      if (!email) return toast("Saisis ton email.", true);
      const { error: resetErreur } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: urlIdentity("recuperation") });
      resetErreur ? erreur(resetErreur) : toast("Lien de reinitialisation envoye");
    });
    rafraichirIcones(document.querySelector("#auth-zone"));
  };
  document.querySelectorAll("[data-auth]").forEach((button) => button.addEventListener("click", () => afficher(button.dataset.auth)));
  afficher(modeInitial);
  rafraichirIcones(app);
}

function rendreDashboard() {
  app.innerHTML = `<div class="app"><header class="bandeau"><div class="bandeau-ligne"><a class="marque" href="../marketplace/index.html"><span style="color:white">IKIGAI</span> <span>Identity</span></a><span class="bandeau-espace">Compte et acces</span><div class="bandeau-actions"><a class="icone-btn" href="../marketplace/index.html" title="Marketplace">${icone("store")}</a><button class="icone-btn" id="deconnexion" title="Deconnexion">${icone("log-out")}</button></div></div></header><div class="conteneur mise-en-page"><nav class="menu-lateral"><button data-tab="profil">${icone("user-round")} Mon profil</button><button data-tab="organisations">${icone("building-2")} Organisations</button><button data-tab="equipe">${icone("users")} Equipe</button><button data-tab="securite">${icone("shield-check")} Securite</button></nav><section id="identity-zone"></section></div><nav class="bottom-nav"><button data-tab="profil">${icone("user-round")}<span>Profil</span></button><button data-tab="organisations">${icone("building-2")}<span>Organisations</span></button><button data-tab="equipe">${icone("users")}<span>Equipe</span></button><a href="../marketplace/index.html">${icone("store")}<span>Market</span></a></nav></div><dialog class="dialogue" id="identity-dialog"><div class="dialogue-entete"><h2 id="dialog-title"></h2><button class="dialogue-fermer" data-fermer>${icone("x")}</button></div><div class="dialogue-corps" id="dialog-zone"></div></dialog>`;
  const onglets = ["profil", "organisations", "equipe", "securite"];
  if (new URLSearchParams(location.search).get("mode") !== "recuperation") {
    etat.onglet = ongletDepuisUrl(onglets, "profil");
  }
  const afficherOnglet = (onglet, memoriser = false) => {
    etat.onglet = onglets.includes(onglet) ? onglet : "profil";
    if (memoriser) memoriserOnglet(etat.onglet);
    rendreOnglet();
  };
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => afficherOnglet(button.dataset.tab, true)));
  window.addEventListener("hashchange", () => afficherOnglet(ongletDepuisUrl(onglets, "profil")));
  document.querySelectorAll("[data-fermer]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelector("#deconnexion").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
  rendreOnglet();
  rafraichirIcones(app);
}

function rendreOnglet() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("actif", button.dataset.tab === etat.onglet));
  const affichages = { profil: afficherProfil, organisations: afficherOrganisations, equipe: afficherEquipe, securite: afficherSecurite };
  affichages[etat.onglet]?.();
}

function afficherProfil() {
  const zone = document.querySelector("#identity-zone");
  zone.innerHTML = `<div class="entete-page"><div><h1>Mon profil</h1><p class="muted">${escapeHtml(etat.session.user.email)}</p></div></div><form class="carte" id="profil-form"><div class="grille-deux"><div class="champ"><label>Prenom</label><input name="prenom" value="${escapeHtml(etat.identite.prenom)}"></div><div class="champ"><label>Nom</label><input name="nom" value="${escapeHtml(etat.identite.nom)}"></div></div><div class="champ"><label>Telephone</label><input name="telephone" type="tel" value="${escapeHtml(etat.identite.telephone)}"></div><div class="champ"><label>Langue</label><select name="langue"><option value="fr" ${etat.identite.langue === "fr" ? "selected" : ""}>Francais</option><option value="en" ${etat.identite.langue === "en" ? "selected" : ""}>English</option></select></div><button class="btn btn-primaire">${icone("save")} Enregistrer</button></form>`;
  zone.querySelector("#profil-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const valeurs = Object.fromEntries(new FormData(event.currentTarget));
    const { error: profilErreur } = await supabase.from("identites").update(valeurs).eq("id", etat.session.user.id);
    if (profilErreur) return erreur(profilErreur);
    Object.assign(etat.identite, valeurs);
    toast("Profil enregistre");
  });
  rafraichirIcones(zone);
}

function afficherOrganisations() {
  const zone = document.querySelector("#identity-zone");
  zone.innerHTML = `<div class="entete-page"><div><h1>Organisations</h1><p class="muted">Tes acces professionnels dans l'ecosysteme IKIGAI</p></div><button class="btn btn-primaire" id="nouvelle-organisation">${icone("plus")} Nouvelle</button></div><div class="pile">${etat.organisations.map((organisation) => `<article class="carte ligne-entre"><div><h3>${escapeHtml(organisation.nom)}</h3><div class="ligne"><span class="badge">${escapeHtml(organisation.type)}</span><span class="muted petit">${escapeHtml(organisation.role)}</span></div></div>${etat.active?.id === organisation.id ? '<span class="badge badge-succes">Active</span>' : `<button class="btn btn-secondaire" data-activer="${organisation.id}">Activer</button>`}</article>`).join("") || '<div class="vide">Aucune organisation</div>'}</div>`;
  zone.querySelectorAll("[data-activer]").forEach((button) => button.addEventListener("click", async () => {
    const { error: activeErreur } = await supabase.from("identites").update({ organisation_active_id: button.dataset.activer }).eq("id", etat.session.user.id);
    if (activeErreur) return erreur(activeErreur);
    etat.active = etat.organisations.find((organisation) => organisation.id === button.dataset.activer);
    toast("Organisation active modifiee");
    afficherOrganisations();
  }));
  zone.querySelector("#nouvelle-organisation").addEventListener("click", () => {
    document.querySelector("#dialog-title").textContent = "Nouvelle organisation";
    document.querySelector("#dialog-zone").innerHTML = `<form id="organisation-form"><div class="champ"><label>Nom</label><input name="nom" required></div><div class="champ"><label>Identifiant</label><input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></div><div class="champ"><label>Activite</label><select name="type"><option value="MARCHAND">Marchand</option><option value="RESTAURANT">Restaurant</option><option value="PRESSING">Pressing</option><option value="LOGISTIQUE">Logistique</option><option value="AUTRE">Autre</option></select></div><button class="btn btn-primaire btn-bloc">Creer</button></form>`;
    const nom = document.querySelector('#organisation-form [name="nom"]');
    const slug = document.querySelector('#organisation-form [name="slug"]');
    let modifie = false;
    slug.addEventListener("input", () => { modifie = true; });
    nom.addEventListener("input", () => { if (!modifie) slug.value = slugifier(nom.value); });
    document.querySelector("#organisation-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      const { error: creationErreur } = await supabase.rpc("rpc_creer_organisation", { p_nom: valeurs.nom, p_slug: valeurs.slug, p_type: valeurs.type });
      if (creationErreur) return erreur(creationErreur);
      toast("Organisation creee");
      location.reload();
    });
    document.querySelector("#identity-dialog").showModal();
  });
  rafraichirIcones(zone);
}

async function afficherEquipe() {
  const zone = document.querySelector("#identity-zone");
  if (!etat.active) {
    zone.innerHTML = '<div class="vide"><h2>Aucune organisation active</h2><p>Cree ou rejoins une organisation pour gerer une equipe.</p></div>';
    return;
  }
  zone.innerHTML = `<div class="entete-page"><div><h1>Equipe</h1><p class="muted">${escapeHtml(etat.active.nom)}</p></div>${["PROPRIETAIRE", "ADMIN"].includes(etat.active.role) ? `<button class="btn btn-primaire" id="inviter">${icone("user-plus")} Inviter</button>` : ""}</div><div id="membres-zone" class="vide">Chargement...</div><div id="invitation-resultat" style="margin-top:15px"></div>`;
  const { data, error: membresErreur } = await supabase.from("membres_organisation").select("identite_id, role, statut, identites(prenom, nom, email)").eq("organisation_id", etat.active.id).order("cree_le");
  if (membresErreur) { zone.querySelector("#membres-zone").textContent = messageErreur(membresErreur); return; }
  zone.querySelector("#membres-zone").outerHTML = `<div class="table-wrap"><table><thead><tr><th>Membre</th><th>Email</th><th>Role</th><th>Statut</th></tr></thead><tbody>${(data || []).map((membre) => `<tr><td><strong>${escapeHtml(`${membre.identites?.prenom || ""} ${membre.identites?.nom || ""}`.trim())}</strong></td><td>${escapeHtml(membre.identites?.email || "")}</td><td>${escapeHtml(membre.role)}</td><td><span class="badge">${escapeHtml(membre.statut)}</span></td></tr>`).join("")}</tbody></table></div>`;
  zone.querySelector("#inviter")?.addEventListener("click", () => {
    document.querySelector("#dialog-title").textContent = "Inviter un membre";
    document.querySelector("#dialog-zone").innerHTML = `<form id="invitation-form"><div class="champ"><label>Email</label><input name="email" type="email" required></div><div class="champ"><label>Role</label><select name="role"><option value="AGENT">Agent</option><option value="GESTIONNAIRE">Gestionnaire</option><option value="ADMIN">Administrateur</option><option value="MEMBRE">Membre</option></select></div><button class="btn btn-primaire btn-bloc">Creer l'invitation</button></form>`;
    document.querySelector("#invitation-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const valeurs = Object.fromEntries(new FormData(event.currentTarget));
      const { data: invitation, error: invitationErreur } = await supabase.rpc("rpc_inviter_membre", { p_organisation_id: etat.active.id, p_email: valeurs.email, p_role: valeurs.role });
      if (invitationErreur) return erreur(invitationErreur);
      const lien = `${location.origin}${location.pathname}?invitation=${invitation.token}`;
      await navigator.clipboard.writeText(lien).catch(() => null);
      document.querySelector("#identity-dialog").close();
      zone.querySelector("#invitation-resultat").innerHTML = `<div class="bande-info"><strong>Lien copie</strong><p class="petit" style="word-break:break-all;margin:6px 0 0">${escapeHtml(lien)}</p></div>`;
      toast("Invitation creee");
    });
    document.querySelector("#identity-dialog").showModal();
  });
  rafraichirIcones(zone);
}

function afficherSecurite() {
  const zone = document.querySelector("#identity-zone");
  zone.innerHTML = `<div class="entete-page"><div><h1>Securite</h1><p class="muted">Mot de passe et sessions</p></div></div><div class="pile"><div class="carte"><h3>Changer le mot de passe</h3><form id="password-form"><div class="champ"><label>Nouveau mot de passe</label><input name="password" type="password" minlength="8" required></div><button class="btn btn-primaire">Mettre a jour</button></form></div><div class="carte"><h3>Autres appareils</h3><p class="muted petit">Ferme toutes les autres sessions encore actives.</p><button class="btn btn-danger" id="autres-sessions">${icone("log-out")} Deconnecter les autres appareils</button></div></div>`;
  zone.querySelector("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    const { error: passwordErreur } = await supabase.auth.updateUser({ password });
    passwordErreur ? erreur(passwordErreur) : toast("Mot de passe mis a jour");
  });
  zone.querySelector("#autres-sessions").addEventListener("click", async () => {
    const { error: sessionsErreur } = await supabase.auth.signOut({ scope: "others" });
    sessionsErreur ? erreur(sessionsErreur) : toast("Autres sessions deconnectees");
  });
  rafraichirIcones(zone);
}

async function demarrer() {
  if (configurationManquante) {
    app.innerHTML = '<main class="conteneur"><div class="vide"><h1>Configuration Supabase manquante</h1><p>Renseigne web/assets/config.js.</p></div></main>';
    return;
  }
  etat.configuration = await chargerConfiguration();
  appliquerTheme(etat.configuration);
  await chargerDonnees();
  if (!etat.session) { rendreAuth(); return; }
  if (new URLSearchParams(location.search).get("mode") === "recuperation") etat.onglet = "securite";
  await accepterInvitation();
  rendreDashboard();
}

demarrer().catch((error) => {
  app.innerHTML = `<main class="conteneur"><div class="vide"><h1>Identity indisponible</h1><p>${escapeHtml(messageErreur(error))}</p></div></main>`;
});
