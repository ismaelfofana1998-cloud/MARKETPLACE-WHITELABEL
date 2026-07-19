import {
  escapeHtml,
  fcfa,
  icone,
  rafraichirIcones,
} from "../assets/api.js?v=17";
import {
  app,
  coquille,
  etat,
  rafraichirExperience,
} from "./shared.js?v=17";

export async function rendreAcquisition() {
  const retourMarchand = "./marchand.html";
  const inscription = `./compte.html?mode=inscription&retour=${encodeURIComponent(retourMarchand)}`;
  const connexion = `./compte.html?mode=connexion&retour=${encodeURIComponent(retourMarchand)}`;
  const actionPrincipale = etat.session ? retourMarchand : inscription;
  const libelleAction = etat.session ? "Ouvrir mon espace" : "Créer ma boutique";
  const minimumLivraison = Number(etat.configuration.livraison_a_partir_de || 1000);
  const navigation = `<nav class="navigation-desktop acquisition-navigation">
    <a href="#solution">La solution</a>
    <a href="#fonctionnalites">Fonctionnalités</a>
    <a href="#demarrage">Comment démarrer</a>
    <a href="#questions">Questions</a>
  </nav>`;
  const actions = `<div class="bandeau-actions acquisition-actions">
    <a class="acquisition-connexion" href="${etat.session ? "./compte.html" : connexion}">${etat.session ? "Mon compte" : "Se connecter"}</a>
    <a class="acquisition-cta-entete" href="${actionPrincipale}">${escapeHtml(libelleAction)}</a>
  </div>`;

  coquille(`<main class="acquisition">
    <section class="acquisition-hero">
      <div class="acquisition-lueur acquisition-lueur-une"></div>
      <div class="acquisition-lueur acquisition-lueur-deux"></div>
      <div class="conteneur acquisition-hero-grille">
        <div class="acquisition-hero-texte">
          <p class="acquisition-sur-titre">${icone("sparkles")} Pensé pour les commerces ivoiriens</p>
          <h1>Votre commerce commence avec IKIGAI.</h1>
          <p class="acquisition-accroche">Créez votre boutique, publiez vos produits, recevez vos commandes et organisez la livraison locale depuis un seul espace.</p>
          <form class="acquisition-email" id="acquisition-email">
            <label class="sr-only" for="acquisition-email-input">Adresse e-mail professionnelle</label>
            <input id="acquisition-email-input" name="email" type="email" placeholder="Votre adresse e-mail" autocomplete="email" required>
            <button type="submit">${escapeHtml(libelleAction)} ${icone("arrow-right")}</button>
          </form>
          <p class="acquisition-aide">Aucune compétence technique requise. Votre espace marchand vous guide étape par étape.</p>
          <div class="acquisition-preuves">
            <span>${icone("circle-check")} Catalogue en FCFA</span>
            <span>${icone("circle-check")} Livraison par zones IKMS</span>
            <span>${icone("circle-check")} Site dédié disponible</span>
          </div>
        </div>

        <div class="acquisition-demo" aria-label="Aperçu de l'espace marchand IKIGAI">
          <div class="acquisition-demo-barre"><span></span><span></span><span></span><strong>IKIGAI · Espace marchand</strong></div>
          <div class="acquisition-demo-corps">
            <aside>
              <div class="acquisition-demo-logo">${icone("store")}</div>
              <span class="actif">${icone("layout-dashboard")} Aperçu</span>
              <span>${icone("package-check")} Commandes</span>
              <span>${icone("package")} Produits</span>
              <span>${icone("truck")} Livraison</span>
            </aside>
            <section>
              <div class="acquisition-demo-entete"><div><small>Bonjour Awa</small><strong>Votre activité aujourd'hui</strong></div><span>${icone("bell")}</span></div>
              <div class="acquisition-demo-kpis">
                <article><small>Ventes</small><strong>245 000</strong><span>FCFA</span></article>
                <article><small>Commandes</small><strong>18</strong><span>+4 aujourd'hui</span></article>
                <article><small>À livrer</small><strong>6</strong><span>Suivies par IKMS</span></article>
              </div>
              <div class="acquisition-demo-commandes">
                <div class="acquisition-demo-titre"><strong>Commandes récentes</strong><span>Voir tout</span></div>
                <div><i></i><p><strong>Commande #1048</strong><small>Cocody · 25 000 FCFA</small></p><b>Confirmée</b></div>
                <div><i></i><p><strong>Commande #1047</strong><small>Yopougon · 18 500 FCFA</small></p><b class="livraison">En livraison</b></div>
                <div><i></i><p><strong>Commande #1046</strong><small>Marcory · 42 000 FCFA</small></p><b class="livree">Livrée</b></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>

    <div class="acquisition-bande-confiance">
      <div class="conteneur">
        <span>${icone("badge-check")} Marchands identifiés</span>
        <span>${icone("banknote")} Prix en FCFA</span>
        <span>${icone("map-pin")} Zones ivoiriennes</span>
        <span>${icone("smartphone")} Utilisable sur téléphone</span>
      </div>
    </div>

    <section class="conteneur acquisition-section acquisition-solution" id="solution">
      <div class="acquisition-entete-section">
        <p class="sur-titre">Tout-en-un, sans complexité</p>
        <h2>Concentrez-vous sur vos clients. IKIGAI organise le reste.</h2>
        <p>Votre boutique en ligne, vos commandes, votre équipe et la livraison locale restent reliées sans mélanger vos données avec celles des autres marchands.</p>
      </div>
      <div class="acquisition-piliers">
        <article>
          <span>${icone("palette")}</span>
          <h3>Une boutique à votre image</h3>
          <p>Logo, couleurs, bandeaux, catégories, référencement et domaine personnalisé selon votre offre.</p>
        </article>
        <article>
          <span>${icone("boxes")}</span>
          <h3>Un catalogue simple à gérer</h3>
          <p>Ajoutez vos produits, variantes, prix, photos et stocks depuis un tableau de bord accessible.</p>
        </article>
        <article>
          <span>${icone("route")}</span>
          <h3>La livraison déjà connectée</h3>
          <p>Les zones et les estimations viennent d'IKMS ; chaque commande reste suivie jusqu'à sa remise.</p>
        </article>
      </div>
    </section>

    <section class="acquisition-section acquisition-fonctionnalites" id="fonctionnalites">
      <div class="conteneur">
        <div class="acquisition-entete-section acquisition-entete-clair">
          <p class="sur-titre">Votre activité dans un seul espace</p>
          <h2>Les outils essentiels pour vendre dès maintenant</h2>
        </div>
        <div class="acquisition-grille-fonctions">
          <article>${icone("store")}<h3>Marketplace et Site dédié</h3><p>Vendez dans le catalogue IKIGAI ou activez une vitrine autonome en marque blanche.</p></article>
          <article>${icone("package-check")}<h3>Commandes en temps réel</h3><p>Confirmez, préparez, confiez au livreur et suivez chaque commande.</p></article>
          <article>${icone("chart-no-axes-combined")}<h3>Vue d'ensemble</h3><p>Suivez vos ventes, les commandes à traiter et les produits dont le stock baisse.</p></article>
          <article>${icone("users")}<h3>Équipe et rôles</h3><p>Invitez vos collaborateurs et donnez à chacun le niveau d'accès adapté.</p></article>
          <article>${icone("truck")}<h3>Connexion IKMS</h3><p>Utilisez votre compte client pro, votre zone de ramassage et votre clé propre.</p></article>
          <article>${icone("shield-check")}<h3>Données isolées</h3><p>Chaque tenant et chaque établissement disposent de leurs propres réglages et commandes.</p></article>
        </div>
      </div>
    </section>

    <section class="conteneur acquisition-section acquisition-local">
      <div class="acquisition-local-visuel">
        <span class="acquisition-carte-zone zone-cocody">COCODY <strong>${fcfa(minimumLivraison)}</strong></span>
        <span class="acquisition-carte-zone zone-yopougon">YOPOUGON <strong>IKMS</strong></span>
        <span class="acquisition-carte-zone zone-marcory">MARCORY <strong>Suivie</strong></span>
        <div class="acquisition-pin pin-un">${icone("map-pin")}</div>
        <div class="acquisition-pin pin-deux">${icone("map-pin")}</div>
        <div class="acquisition-trajet"></div>
        <div class="acquisition-colis">${icone("package-check")}<span>Commande confiée au livreur</span></div>
      </div>
      <div class="acquisition-local-texte">
        <p class="sur-titre">Conçu pour votre réalité</p>
        <h2>Le commerce ivoirien n'a pas besoin d'une copie importée.</h2>
        <p>IKIGAI conserve l'esprit d'un grand écosystème e-commerce, mais l'adapte aux usages locaux : FCFA, zones de livraison, paiement à la remise et connexion avec votre opérateur logistique.</p>
        <ul>
          <li>${icone("check")} Une zone de ramassage préenregistrée pour votre boutique</li>
          <li>${icone("check")} Une estimation de livraison avant la confirmation</li>
          <li>${icone("check")} Un suivi client limité aux jalons réellement utiles</li>
        </ul>
      </div>
    </section>

    <section class="acquisition-section acquisition-demarrage" id="demarrage">
      <div class="conteneur">
        <div class="acquisition-entete-section">
          <p class="sur-titre">Prêt en trois étapes</p>
          <h2>De votre inscription à votre première commande</h2>
        </div>
        <ol class="acquisition-etapes">
          <li><span>1</span><div><strong>Créez votre compte</strong><p>Renseignez votre identité et votre zone habituelle depuis le formulaire sécurisé.</p></div></li>
          <li><span>2</span><div><strong>Ouvrez votre boutique</strong><p>Choisissez votre nom, votre zone de ramassage et ajoutez vos premiers produits.</p></div></li>
          <li><span>3</span><div><strong>Commencez à vendre</strong><p>Publiez votre vitrine, recevez les commandes et connectez votre compte pro IKMS.</p></div></li>
        </ol>
        <a class="btn btn-primaire acquisition-gros-cta" href="${actionPrincipale}">${escapeHtml(libelleAction)} ${icone("arrow-right")}</a>
      </div>
    </section>

    <section class="conteneur acquisition-section acquisition-faq" id="questions">
      <div class="acquisition-entete-section"><p class="sur-titre">Questions fréquentes</p><h2>Avant de vous lancer</h2></div>
      <div class="acquisition-faq-liste">
        <details><summary>Dois-je savoir créer un site internet ? ${icone("plus")}</summary><p>Non. Vous renseignez vos informations, vos produits et vos couleurs depuis des formulaires guidés. Aucune programmation n'est nécessaire.</p></details>
        <details><summary>Puis-je vendre uniquement dans la marketplace ? ${icone("plus")}</summary><p>Oui. Vous pouvez commencer dans le catalogue commun, puis passer à un Site dédié lorsque votre offre et votre marque le nécessitent.</p></details>
        <details><summary>Comment les frais de livraison sont-ils calculés ? ${icone("plus")}</summary><p>IKIGAI compare la zone de votre boutique à celle du client avec la grille IKMS. L'estimation est affichée avant validation et le montant IKMS confirmé reste la référence.</p></details>
        <details><summary>Qui reçoit l'argent de mes ventes ? ${icone("plus")}</summary><p>Le fonctionnement actuel privilégie le paiement à la livraison. La configuration Wave par tenant est préparée, mais son activation au checkout sera déployée progressivement.</p></details>
        <details><summary>Puis-je travailler avec mon équipe ? ${icone("plus")}</summary><p>Oui. Les rôles permettent de séparer la propriété, l'administration, la gestion du catalogue et les opérations quotidiennes.</p></details>
      </div>
    </section>

    <section class="acquisition-final">
      <div class="conteneur">
        <p class="acquisition-sur-titre">${icone("rocket")} Votre prochain client peut déjà être en ligne</p>
        <h2>Donnez à votre commerce l'espace qu'il mérite.</h2>
        <p>Commencez par créer votre compte. Vous pourrez ensuite configurer votre boutique à votre rythme.</p>
        <form class="acquisition-email acquisition-email-final" id="acquisition-email-final">
          <label class="sr-only" for="acquisition-email-final-input">Adresse e-mail professionnelle</label>
          <input id="acquisition-email-final-input" name="email" type="email" placeholder="Votre adresse e-mail" autocomplete="email" required>
          <button type="submit">${escapeHtml(libelleAction)} ${icone("arrow-right")}</button>
        </form>
        <a class="acquisition-retour-market" href="./index.html">Je souhaite plutôt acheter sur IKIGAI</a>
      </div>
    </section>
  </main>`, {
    mode: "gestion",
    espace: "Pour les marchands",
    navigation,
    actions,
  });

  const continuer = (formulaire) => {
    const email = String(new FormData(formulaire).get("email") || "").trim();
    if (etat.session) {
      location.href = retourMarchand;
      return;
    }
    const url = new URL(inscription, location.href);
    if (email) url.searchParams.set("email", email);
    location.href = url.href;
  };
  document.querySelectorAll("#acquisition-email, #acquisition-email-final").forEach((formulaire) => {
    formulaire.addEventListener("submit", (event) => {
      event.preventDefault();
      continuer(event.currentTarget);
    });
  });
  rafraichirExperience(app);
  rafraichirIcones(app);
}
