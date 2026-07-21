#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const PROJECT_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const TEST_PASSWORD = String(process.env.MARKETPLACE_TEST_PASSWORD || "");
const CLEANUP = process.argv.includes("--cleanup");

const SHOP_COUNT = 50;
const WHITE_LABEL_COUNT = 5;
const PRODUCTS_PER_SHOP = 3;
const TEST_SLUG_PREFIX = "ikigai-test-";
const TEST_EMAIL_PREFIX = "boutique.test";

if (!PROJECT_URL || !SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.");
}
if (!CLEANUP && TEST_PASSWORD.length < 8) {
  throw new Error("MARKETPLACE_TEST_PASSWORD doit contenir au moins 8 caractères.");
}

const shopNames = [
  "Abidjan Élégance", "Naya Beauté", "Maison Baoulé", "Tech Lagune", "Petit Ivoire",
  "Kawa Concept", "Cocody Dressing", "Saveurs du Marché", "Babi Mobile", "Les Trésors d'Awa",
  "Soleil d'Afrique", "Chez Mariam", "Ivoire Déco", "Lagune Kids", "Belle Peau CI",
  "Le Comptoir d'Adjamé", "Marcory Maison", "Aya Créations", "Yop Shop", "Korhogo Style",
  "San-Pédro Market", "Bouaké Sélection", "Dabou Gourmand", "Bassam Chic", "Riviera Tech",
  "Le Panier Ivoirien", "Nouchi Sneakers", "Ébène & Or", "Attiéké Maison", "Bingerville Bébé",
  "Treich Accessoires", "Plateau Pro", "Anono Fraîcheur", "Koumassi Deals", "Deux-Plateaux Mode",
  "Abobo Pratique", "Angré Beauté", "Vridi Équipement", "Palmeraie Boutique", "Zone 4 Gourmet",
  "M'Pouto Design", "Faya Mobile", "Niangon Famille", "Bonoumin Maison", "Williamsville Shop",
  "Port-Bouët Sélection", "Gonzagueville Market", "Songon Nature", "Anyama Essentiel", "Azaguié Terroir",
];

const themes = [
  ["#C75332", "#17211F", "#E9AE36"],
  ["#7A284B", "#21151B", "#F0A6CA"],
  ["#146C60", "#102B26", "#F4C95D"],
  ["#2457C5", "#101B33", "#57C4E5"],
  ["#6D3CB8", "#211631", "#F2B84B"],
];

const imageUrls = {
  mode: [
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80",
  ],
  maison: [
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80",
  ],
  beaute: [
    "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?auto=format&fit=crop&w=900&q=80",
  ],
  epicerie: [
    "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1606787366850-de6330128bfc?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1506484381205-f7945653044d?auto=format&fit=crop&w=900&q=80",
  ],
  "high-tech": [
    "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1585060544812-6b45742d762f?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1546868871-7041f2a55e12?auto=format&fit=crop&w=900&q=80",
  ],
  enfants: [
    "https://images.unsplash.com/photo-1599443015574-be5fe8a05783?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=900&q=80",
  ],
};

const productTemplates = {
  mode: [
    ["Chemise en coton premium", 12500, "Une chemise légère et élégante, adaptée au climat ivoirien."],
    ["Baskets urbaines confort", 28500, "Des baskets polyvalentes pour le quotidien, avec une semelle souple."],
    ["Sac à main structuré", 22000, "Un sac pratique au style contemporain, avec plusieurs rangements."],
  ],
  maison: [
    ["Coussin décoratif wax", 8500, "Une touche de couleur pour le salon, confectionnée dans un tissu résistant."],
    ["Lampe de table artisanale", 18000, "Une lumière douce pour créer une ambiance chaleureuse à la maison."],
    ["Panier de rangement tressé", 14500, "Un rangement décoratif et pratique pour toutes les pièces."],
  ],
  beaute: [
    ["Coffret soin éclat", 16500, "Une routine simple pour nettoyer, hydrater et illuminer la peau."],
    ["Huile corporelle nourrissante", 7500, "Une huile légère qui nourrit la peau sans laisser de fini gras."],
    ["Palette maquillage essentiels", 13500, "Des teintes faciles à porter, du quotidien aux grandes occasions."],
  ],
  epicerie: [
    ["Panier gourmand ivoirien", 19500, "Une sélection de produits du terroir à partager en famille."],
    ["Café de Côte d'Ivoire", 6500, "Un café aromatique torréfié avec soin et conditionné localement."],
    ["Épices cuisine maison", 4500, "Un assortiment équilibré pour relever sauces, grillades et poissons."],
  ],
  "high-tech": [
    ["Écouteurs Bluetooth autonomie+", 24500, "Des écouteurs sans fil avec boîtier de charge et commandes tactiles."],
    ["Chargeur rapide double port", 12000, "Rechargez deux appareils rapidement à la maison ou au bureau."],
    ["Montre connectée active", 32000, "Suivi d'activité, notifications et autonomie pensée pour le quotidien."],
  ],
  enfants: [
    ["Ensemble enfant coton doux", 11000, "Une tenue confortable et facile à entretenir pour tous les jours."],
    ["Jeu de construction créatif", 15000, "Un jeu ludique qui développe l'imagination et la motricité."],
    ["Sac à dos école léger", 13500, "Un sac confortable avec des compartiments adaptés aux essentiels."],
  ],
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function request(path, { method = "GET", body, prefer, schema } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  if (schema) {
    headers["Content-Profile"] = schema;
    headers["Accept-Profile"] = schema;
  }
  const response = await fetch(`${PROJECT_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} a échoué (${response.status}) : ${text.slice(0, 1000)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function restSelect(table, query = "") {
  return request(`/rest/v1/${table}?${query}`, { schema: "public" });
}

async function restUpsert(table, rows, conflictColumns) {
  if (!rows.length) return [];
  const query = conflictColumns ? `?on_conflict=${encodeURIComponent(conflictColumns)}` : "";
  return request(`/rest/v1/${table}${query}`, {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
    schema: "public",
  });
}

async function listAllTestUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const pageUsers = Array.isArray(result) ? result : result?.users || [];
    users.push(...pageUsers.filter((user) => String(user.email || "").startsWith(TEST_EMAIL_PREFIX)));
    if (pageUsers.length < 1000) break;
  }
  return users;
}

async function ensureUsers() {
  const usersByEmail = new Map((await listAllTestUsers()).map((user) => [user.email, user]));
  const users = [];

  for (let index = 1; index <= SHOP_COUNT; index += 1) {
    const email = `${TEST_EMAIL_PREFIX}${pad(index)}@test.com`;
    const metadata = {
      prenom: "Marchand",
      nom: `Test ${pad(index)}`,
      telephone: `070100${String(index).padStart(4, "0")}`,
      zone_livraison: ["COC", "MAR", "NIANGO", "SELMER", "SICOGI", "YOP"][index % 6],
      donnees_test: true,
    };
    let user = usersByEmail.get(email);
    if (user) {
      user = await request(`/auth/v1/admin/users/${user.id}`, {
        method: "PUT",
        body: { password: TEST_PASSWORD, email_confirm: true, user_metadata: metadata },
      });
    } else {
      user = await request("/auth/v1/admin/users", {
        method: "POST",
        body: { email, password: TEST_PASSWORD, email_confirm: true, user_metadata: metadata },
      });
    }
    users.push(user);
  }
  return users;
}

async function cleanup() {
  const organisations = await restSelect("organisations", `select=id&slug=like.${TEST_SLUG_PREFIX}*`);
  if (organisations.length) {
    await request(`/rest/v1/organisations?slug=like.${TEST_SLUG_PREFIX}*`, {
      method: "DELETE",
      prefer: "return=minimal",
      schema: "public",
    });
  }
  const users = await listAllTestUsers();
  for (const user of users) {
    await request(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });
  }
  console.log(`Nettoyage terminé : ${organisations.length} organisation(s), ${users.length} compte(s) test supprimé(s).`);
}

async function seed() {
  console.log("Création ou mise à jour des 50 comptes test confirmés…");
  const users = await ensureUsers();

  const organisations = users.map((user, offset) => {
    const index = offset + 1;
    return {
      id: randomUUID(),
      nom: `${shopNames[offset]} — Recette`,
      slug: `${TEST_SLUG_PREFIX}organisation-${pad(index)}`,
      type: "MARCHAND",
      pays: "CI",
      devise: "XOF",
      actif: true,
      cree_par: user.id,
    };
  });
  const existingOrganisations = await restSelect(
    "organisations",
    `select=id,slug,cree_par&slug=like.${TEST_SLUG_PREFIX}*`,
  );
  const existingOrganisationBySlug = new Map(existingOrganisations.map((row) => [row.slug, row]));
  for (const organisation of organisations) {
    const existing = existingOrganisationBySlug.get(organisation.slug);
    if (existing) organisation.id = existing.id;
  }
  const savedOrganisations = await restUpsert("organisations", organisations, "slug");
  const organisationBySlug = new Map(savedOrganisations.map((row) => [row.slug, row]));

  const memberships = [];
  const offers = [];
  const identities = [];
  const shops = [];
  for (let index = 1; index <= SHOP_COUNT; index += 1) {
    const user = users[index - 1];
    const organisation = organisationBySlug.get(`${TEST_SLUG_PREFIX}organisation-${pad(index)}`);
    const whiteLabel = index <= WHITE_LABEL_COUNT;
    memberships.push({
      organisation_id: organisation.id,
      identite_id: user.id,
      role: "PROPRIETAIRE",
      statut: "ACTIF",
    });
    offers.push({
      organisation_id: organisation.id,
      offre: whiteLabel ? "WHITE_LABEL" : "STANDARD",
      white_label_actif: whiteLabel,
      domaines_personnalises: false,
      max_etablissements: whiteLabel ? 3 : 1,
      active: true,
    });
    identities.push({
      id: user.id,
      email: user.email,
      prenom: "Marchand",
      nom: `Test ${pad(index)}`,
      telephone: `070100${String(index).padStart(4, "0")}`,
      zone_livraison: ["COC", "MAR", "NIANGO", "SELMER", "SICOGI", "YOP"][index % 6],
      organisation_active_id: organisation.id,
    });
    shops.push({
      id: randomUUID(),
      organisation_id: organisation.id,
      nom: shopNames[index - 1],
      slug: `${TEST_SLUG_PREFIX}boutique-${pad(index)}`,
      code_etablissement: "principal",
      mode_vitrine: whiteLabel ? "WHITE_LABEL" : "MARKETPLACE",
      description: `${shopNames[index - 1]} est une boutique de démonstration créée pour tester l'expérience IKIGAI Marketplace.`,
      logo_url: imageUrls[Object.keys(imageUrls)[(index - 1) % 6]][0],
      banniere_url: imageUrls[Object.keys(imageUrls)[(index - 1) % 6]][1],
      telephone: `070200${String(index).padStart(4, "0")}`,
      whatsapp: `225070200${String(index).padStart(4, "0")}`,
      adresse: `${index}, rue de la Démonstration, Abidjan`,
      email_contact: `${TEST_EMAIL_PREFIX}${pad(index)}@test.com`,
      statut: "PUBLIEE",
      frais_livraison_base: 1000 + (index % 5) * 250,
      note_moyenne: Number((4 + (index % 10) / 10).toFixed(1)),
      delai_preparation_minutes: 60,
    });
  }

  await restUpsert("membres_organisation", memberships, "organisation_id,identite_id");
  await restUpsert("offres_organisations", offers, "organisation_id");
  await restUpsert("identites", identities, "id");

  const existingShops = await restSelect(
    "boutiques",
    `select=id,slug&slug=like.${TEST_SLUG_PREFIX}*`,
  );
  const existingShopBySlug = new Map(existingShops.map((row) => [row.slug, row]));
  const missingShops = [];
  for (const shop of shops) {
    const existing = existingShopBySlug.get(shop.slug);
    if (existing) shop.id = existing.id;
    else missingShops.push(shop);
  }
  await restUpsert("boutiques", missingShops, null);
  const savedShops = shops;
  const shopBySlug = new Map(savedShops.map((row) => [row.slug, row]));

  const configurations = savedShops.map((shop) => {
    const shopIndex = Number(shop.slug.slice(-2));
    const offset = shopIndex - 1;
    const whiteLabel = shopIndex <= WHITE_LABEL_COUNT;
    const palette = themes[offset % themes.length];
    const categorySlug = Object.keys(imageUrls)[offset % 6];
    return {
      boutique_id: shop.id,
      nom_site: shop.nom,
      slogan: whiteLabel ? "Votre sélection, livrée simplement à Abidjan" : null,
      description: `Découvrez les produits de ${shop.nom}, disponibles sur IKIGAI Marketplace.`,
      annonce: whiteLabel ? "Livraison automatisée avec IKMS • Paiement à la livraison" : null,
      logo_url: imageUrls[categorySlug][0],
      hero_images: whiteLabel ? [imageUrls[categorySlug][1], imageUrls[categorySlug][2]] : [],
      couleur_primaire: palette[0],
      couleur_secondaire: palette[1],
      couleur_accent: palette[2],
      email_support: shop.email_contact,
      telephone_support: shop.telephone,
      whatsapp: shop.whatsapp,
      masquer_autres_boutiques: whiteLabel,
      masquer_categories_globales: whiteLabel,
      afficher_signature_plateforme: whiteLabel,
      seo_titre: `${shop.nom} | Boutique en ligne`,
      seo_description: `Commandez les produits de ${shop.nom} et faites-vous livrer à Abidjan.`,
    };
  });
  await restUpsert("configurations_boutique", configurations, "boutique_id");

  const categories = await restSelect(
    "categories_marketplace",
    "select=id,slug,nom&actif=eq.true&order=ordre.asc",
  );
  const categoryBySlug = new Map(categories.map((row) => [row.slug, row]));
  for (const slug of Object.keys(productTemplates)) {
    if (!categoryBySlug.has(slug)) throw new Error(`Catégorie marketplace manquante : ${slug}`);
  }

  const existingProducts = await restSelect(
    "produits",
    `select=id,boutique_id,slug&boutique_id=in.(${savedShops.map((shop) => shop.id).join(",")})`,
  );
  const existingProductByKey = new Map(
    existingProducts.map((product) => [`${product.boutique_id}:${product.slug}`, product]),
  );
  const products = [];
  for (let shopIndex = 1; shopIndex <= SHOP_COUNT; shopIndex += 1) {
    const shop = shopBySlug.get(`${TEST_SLUG_PREFIX}boutique-${pad(shopIndex)}`);
    const categorySlug = Object.keys(productTemplates)[(shopIndex - 1) % 6];
    const category = categoryBySlug.get(categorySlug);
    for (let productIndex = 1; productIndex <= PRODUCTS_PER_SHOP; productIndex += 1) {
      const [name, basePrice, description] = productTemplates[categorySlug][productIndex - 1];
      const price = basePrice + (shopIndex % 4) * 500;
      const slug = `${slugify(name)}-${pad(productIndex)}`;
      const existingProduct = existingProductByKey.get(`${shop.id}:${slug}`);
      products.push({
        id: existingProduct?.id || randomUUID(),
        boutique_id: shop.id,
        categorie_id: category.id,
        nom: name,
        slug,
        description,
        prix: price,
        prix_barre: shopIndex % 3 === 0 ? price + 3000 : null,
        images: [imageUrls[categorySlug][productIndex - 1]],
        statut: "ACTIF",
        poids_grammes: 250 + productIndex * 150,
        marque: shop.nom,
        tags: ["test", "cote-divoire", categorySlug],
      });
    }
  }

  const savedProducts = await restUpsert("produits", products, "boutique_id,slug");
  const shopIndexById = new Map(
    savedShops.map((shop) => [shop.id, Number(shop.slug.slice(-2))]),
  );
  const existingVariants = await restSelect(
    "variantes_produit",
    "select=id,sku&sku=like.TST-*",
  );
  const existingVariantBySku = new Map(
    existingVariants.map((variant) => [variant.sku, variant]),
  );
  const variants = savedProducts.map((product) => {
    const shopIndex = shopIndexById.get(product.boutique_id);
    const productIndex = Number(product.slug.slice(-2));
    if (!shopIndex || !productIndex) {
      throw new Error(`Produit test non identifiable : ${product.id}`);
    }
    const sku = `TST-${pad(shopIndex)}-${pad(productIndex)}`;
    return {
      id: existingVariantBySku.get(sku)?.id || randomUUID(),
      produit_id: product.id,
      sku,
      nom: "Standard",
      attributs: { donnees_test: true },
      prix: null,
      actif: true,
    };
  });
  const savedVariants = await restUpsert("variantes_produit", variants, "sku");
  const stocks = savedVariants.map((variant, index) => ({
    variante_id: variant.id,
    quantite: 12 + (index % 38),
    seuil_alerte: 5,
  }));
  await restUpsert("stocks", stocks, "variante_id");

  console.log(
    `Jeu de recette prêt : ${users.length} comptes, ${savedShops.length} boutiques, ` +
      `${WHITE_LABEL_COUNT} sites dédiés et ${savedProducts.length} produits.`,
  );
}

if (CLEANUP) {
  await cleanup();
} else {
  await seed();
}
