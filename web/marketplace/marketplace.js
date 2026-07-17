import { messageErreur, rafraichirIcones } from "../assets/api.js?v=10";
import { rendreAdmin } from "./admin.js?v=10";
import { rendreCompte } from "./account.js?v=10";
import { rendreMarchand } from "./merchant.js?v=10";
import { initialiser, verifierConfiguration, app, vide } from "./shared.js?v=10";
import { rendreAccueil, rendreCheckout, rendrePanier, rendreProduit } from "./storefront.js?v=10";

const pages = {
  accueil: rendreAccueil,
  produit: rendreProduit,
  panier: rendrePanier,
  checkout: rendreCheckout,
  compte: rendreCompte,
  marchand: rendreMarchand,
  admin: rendreAdmin,
};

async function demarrer() {
  if (!verifierConfiguration()) return;
  await initialiser();
  const page = document.body.dataset.page || "accueil";
  await (pages[page] || rendreAccueil)();
  rafraichirIcones(app);
}

demarrer().catch((error) => {
  app.innerHTML = `<main class="conteneur">${vide("triangle-alert", "Impossible de demarrer l'application", messageErreur(error))}</main>`;
  rafraichirIcones(app);
});
