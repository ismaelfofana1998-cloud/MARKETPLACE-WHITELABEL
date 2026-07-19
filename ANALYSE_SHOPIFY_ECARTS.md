# Analyse Shopify — écarts et priorités pour IKIGAI Marketplace White Label

Date de l'audit : 19 juillet 2026

## Positionnement recommandé

IKIGAI Marketplace White Label ne doit pas chercher à reproduire Shopify fonction par
fonction. Shopify est une plateforme mondiale généraliste ; IKIGAI peut gagner en étant
la plateforme de commerce la plus simple à exploiter en Côte d'Ivoire, avec Wave, le
FCFA, la livraison par zones et IKMS intégrés de manière native.

Le cap proposé est donc :

1. rendre la création de boutique et la première vente extrêmement simples ;
2. donner aux marchands les outils qui augmentent réellement leurs ventes ;
3. fiabiliser les paiements, retours et remboursements ;
4. ouvrir progressivement l'écosystème à des intégrations tierces.

## Ce que Marketplace possède déjà

- Marketplace multi-boutiques et boutiques dédiées en marque blanche.
- Catalogue public, recherche, catégories, variantes et gestion du stock.
- Panier persistant, commande multi-marchands et contrôle du stock.
- Comptes clients, profil, adresses, favoris et historique des commandes.
- Espace marchand pour les produits, commandes, équipe et établissement.
- Personnalisation de la boutique : identité, couleurs, héros et domaine.
- Administration des tenants et des boutiques.
- Intégration logistique IKMS : zones, estimation, création et suivi de commande.
- Isolation des données par établissement et clés API chiffrées.
- Suivi client simplifié et e-mails sur les jalons métier.
- PWA et expérience adaptée au mobile.

## Écarts prioritaires

### Priorité 1 — indispensables à la croissance locale

| Fonction | État Marketplace | Recommandation |
|---|---|---|
| Paiement Wave par tenant | Configuration préparée, activation checkout encore progressive | Finaliser le paiement marchand, les confirmations, les échecs et l'idempotence |
| Retours et remboursements | Annulation présente, parcours financier incomplet | Ajouter demandes de retour, validation marchand, remise en stock et remboursement Wave |
| Promotions | Pas de moteur complet | Codes promo, pourcentage, montant fixe, livraison offerte et promotions automatiques |
| Relance commerciale | Pas de relance de panier complète | E-mail puis WhatsApp/SMS, avec consentement et lien de reprise du panier |
| Analyse des ventes | Indicateurs opérationnels présents mais limités | Conversion, panier moyen, produits performants, ventes par période et export CSV |
| Catalogue en volume | Gestion produit surtout unitaire | Import/export CSV et modification groupée des prix, stocks et statuts |

### Priorité 2 — professionnalisation des boutiques

| Fonction | État Marketplace | Recommandation |
|---|---|---|
| Éditeur de thème | Personnalisation guidée, pas d'éditeur par blocs | Sections déplaçables, aperçu mobile/ordinateur, brouillon et publication |
| Contenu et navigation | Pages commerciales limitées | Pages libres, menus, FAQ, blog/actualités et politiques de boutique |
| Catalogue avancé | Variantes présentes | Collections automatiques, champs personnalisés, lots, cartes-cadeaux et produits numériques |
| Stock multi-emplacements | Stock centré sur l'établissement | Dépôts/boutiques multiples, transferts, réservations et règles de préparation |
| Retours en libre-service | Non disponible | Demande depuis le compte client, motifs, preuves, échanges et règles par boutique |
| Canaux de vente | Vitrine web principale | Catalogue WhatsApp, réseaux sociaux et flux Google Merchant lorsque le socle est stable |
| Vente physique | Pas de caisse unifiée | Un mini-POS mobile partageant produits, clients, commandes et stock |

### Priorité 3 — plateforme et écosystème

| Fonction | État Marketplace | Recommandation |
|---|---|---|
| Applications tierces | Intégrations internes ciblées | API publique versionnée, webhooks, permissions et catalogue d'intégrations validées |
| Automatisations | Quelques automatismes métier | Moteur simple « événement → condition → action » |
| B2B / vente en gros | Non spécialisé | Comptes entreprise, catalogues et prix par client, minima et délais de paiement |
| International | FCFA et marché local privilégiés | Ne l'ajouter qu'en cas de demande : langues, devises, taxes et domaines par marché |
| Fidélité | Favoris et comptes clients | Points, parrainage, segments et offres ciblées |
| Risque paiement | Contrôles techniques, pas de moteur métier | Signaux de fraude, règles de validation et journal de litige |
| Assistance IA | Non disponible | Aide aux descriptions, photos, réponses clients et lecture des performances |

## Priorités recommandées pour les 12 prochains mois

### Phase A — vendre et encaisser sereinement

- Finaliser Wave par tenant.
- Concevoir le parcours de retour et de remboursement avant d'activer largement Wave.
- Ajouter codes promo et promotions simples.
- Ajouter exports commandes/produits et tableau de bord commercial.
- Mettre en production la nouvelle page « Vendre sur IKIGAI ».

### Phase B — faire revenir les clients

- Relance des paniers abandonnés.
- Segmentation simple des clients.
- Campagnes e-mail, puis WhatsApp/SMS avec consentement.
- Fidélité et parrainage.

### Phase C — faire gagner du temps aux marchands

- Import et modification groupée du catalogue.
- Éditeur de boutique par sections.
- Collections automatiques et catalogue enrichi.
- Stock multi-emplacements si les marchands en ont réellement besoin.

### Phase D — devenir un écosystème

- API publique et webhooks documentés.
- Intégrations comptables, marketing et logistiques.
- Automatisations configurables.
- Mini-POS et B2B selon la demande observée.

## Ce qu'il ne faut pas prioriser maintenant

- La vente multidevise mondiale.
- Un App Store public sans gouvernance de sécurité.
- Des fonctions B2B complexes sans marchands pilotes.
- Des centaines de thèmes avant d'avoir un bon éditeur de sections.
- Une IA générative avant les fonctions de paiement, retour, promotion et analyse.

## Différenciation ivoirienne à préserver

- Prix et comptabilité en FCFA.
- Paiement Wave configuré par marchand.
- Zones de livraison issues du partenaire logistique, sans saisie libre incohérente.
- Estimation de livraison avant validation et montant IKMS définitif à la commande.
- Possibilité future de déléguer les flux logistiques sans exposer la complexité au marchand.
- Expérience mobile légère, utilisable avec une connexion instable.
- Support et messages en français clair, avec WhatsApp comme canal naturel.

