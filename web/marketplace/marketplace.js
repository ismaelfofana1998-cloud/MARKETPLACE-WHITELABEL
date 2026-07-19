import { messageErreur, rafraichirIcones } from "../assets/api.js?v=18";
import { rendreAcquisition } from "./acquisition.js?v=18";
import { rendreAdmin } from "./admin.js?v=18";
import { rendreCompte } from "./account.js?v=19";
import { rendreMarchand } from "./merchant.js?v=18";
import { initialiser, verifierConfiguration, app, vide } from "./shared.js?v=18";
import { rendreAccueil, rendreCheckout, rendrePanier, rendreProduit } from "./storefront.js?v=19";

const pages = {
  accueil: rendreAccueil,
  produit: rendreProduit,
  panier: rendrePanier,
  checkout: rendreCheckout,
  compte: rendreCompte,
  marchand: rendreMarchand,
  admin: rendreAdmin,
  vendre: rendreAcquisition,
};

async function demarrer() {
  if (!verifierConfiguration()) return;
  app.innerHTML = `<div class="demarrage-app">
    <div class="demarrage-marque"><span>IKIGAI</span> Market</div>
    <div class="demarrage-indicateur" role="status" aria-label="Ouverture de la marketplace"></div>
  </div>`;
  await initialiser();
  const page = document.body.dataset.page || "accueil";
  await (pages[page] || rendreAccueil)();
  rafraichirIcones(app);
}

demarrer().catch((error) => {
  app.innerHTML = `<main class="conteneur page-visible">${vide("triangle-alert", "Impossible de demarrer l'application", messageErreur(error))}</main>`;
  rafraichirIcones(app);
});
