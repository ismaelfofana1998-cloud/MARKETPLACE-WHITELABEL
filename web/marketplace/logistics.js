import {
  escapeHtml,
  fcfa,
  icone,
} from "../assets/api.js?v=17";

export function statutSuiviMarketplace(statutCommande) {
  if (statutCommande === "ANNULEE") return "ANNULEE";
  if (statutCommande === "LIVREE") return "LIVREE";
  if (statutCommande === "EN_LIVRAISON") return "EN_LIVRAISON";
  return "CONFIRMEE";
}

export function rendreParcoursLivraison(statutCommande) {
  const statutSuivi = statutSuiviMarketplace(statutCommande);
  const annulee = statutSuivi === "ANNULEE";
  const courant = statutSuivi === "LIVREE"
    ? 2
    : statutSuivi === "EN_LIVRAISON"
      ? 1
      : 0;
  const etapes = [
    ["Commande confirmee", "La commande est enregistree dans Marketplace."],
    ["Confiee au livreur", "La commande a ete remise au service de livraison."],
    ["Livree", "La livraison de la commande est confirmee."],
  ];

  if (annulee) {
    return '<div class="bande-info bande-danger suivi-alerte"><strong>Commande annulee</strong><p class="petit">Cette commande ne sera pas livree.</p></div>';
  }

  return `<ol class="parcours-livraison">${etapes.map(([titre, description], index) => {
    const classe = index < courant || (courant === 2 && index === 2)
      ? "terminee"
      : index === courant
        ? "active"
        : "en-attente";
    const marqueur = classe === "terminee" ? icone("check") : String(index + 1);
    return `<li class="${classe}"><span class="parcours-marqueur">${marqueur}</span><div><strong>${escapeHtml(titre)}</strong><p>${escapeHtml(description)}</p></div></li>`;
  }).join("")}</ol>`;
}

export function rendreCodesMission(mission, { marchand = false } = {}) {
  if (!marchand || (!mission?.code_livraison && !mission?.code_ramassage)) return "";
  return `<div class="codes-logistiques">
    ${mission.code_ramassage ? `<div class="code-logistique"><span>${icone("package-open")} Code de ramassage</span><strong>${escapeHtml(mission.code_ramassage)}</strong><small>A communiquer uniquement au livreur present.</small></div>` : ""}
    ${mission.code_livraison ? `<div class="code-logistique code-logistique-livraison"><span>${icone("shield-check")} Code de livraison</span><strong>${escapeHtml(mission.code_livraison)}</strong><small>A transmettre au destinataire, jamais au livreur avant la remise.</small></div>` : ""}
  </div>`;
}

export function rendreComparaisonFrais(commande, mission) {
  if (!mission || mission.montant_livraison === null || mission.montant_livraison === undefined) return "";
  const facture = Number(commande?.frais_livraison || 0);
  const cout = Number(mission.montant_livraison || 0);
  const ecart = facture - cout;
  return `<div class="carte rapprochement-livraison">
    <div><span class="muted petit">Facture au client</span><strong>${fcfa(facture)}</strong></div>
    <div><span class="muted petit">Tarif livraison</span><strong>${fcfa(cout)}</strong></div>
    <div class="${ecart < 0 ? "ecart-negatif" : ""}"><span class="muted petit">Ecart livraison</span><strong>${ecart > 0 ? "+" : ""}${fcfa(ecart)}</strong></div>
  </div>`;
}
