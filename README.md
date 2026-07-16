# IKIGAI Market

Marketplace multi-boutiques et plateforme white-label multi-tenant reliée à
Supabase et à IKIGAI Livraison.

Le projet est volontairement simple a publier : aucune compilation n'est
necessaire. GitHub Pages sert directement le dossier `web`.

## Ce qui est operationnel

- catalogue public, recherche, categories, boutiques et fiches produits ;
- compte client commun, profil, adresses, favoris et historique des commandes ;
- panier persistant, controle du stock et commande multi-boutiques ;
- offre Site dédié avec plusieurs établissements et une URL propre à chacun ;
- thème, bandeau, filtres, catégories, SEO et domaines propres à chaque Site dédié ;
- paniers, commandes affichées et configuration IKMS isolés par établissement ;
- paiement a la livraison ;
- espace marchand avec commandes en temps reel, catalogue, images et stock ;
- apparence administrable avec logo supprimable et bandeau defilant jusqu'a six images ;
- roles `PROPRIETAIRE`, `ADMIN`, `GESTIONNAIRE`, `AGENT` et `MEMBRE` ;
- espace SuperAdmin pour les tenants, boutiques, categories et le theme ;
- invitations par lien et initialisation unique du premier SuperAdmin ;
- intégration IKMS par établissement avec clé API chiffrée, suivi automatique et codes de livraison ;
- emails transactionnels persistants pour chaque statut de commande ;
- application installable sur telephone.

## Installation Supabase

Le dossier standard `supabase/migrations` contient l'historique reproductible
pour le nouveau projet `kcwcxnfxhvjujmticuwv` :

1. `20260716092919_white_label_multi_establishments.sql` installe le socle
   historique puis l'architecture `WHITE_LABEL` multi-établissements ;
2. `20260716092931_white_label_cart_ikms.sql` isole les paniers et IKMS par
   établissement et migre Soum Cosmétique lorsqu'elle existe dans les données ;
3. `20260716093430_white_label_hardening.sql` applique les garde-fous de capacité ;
4. `20260716093615_white_label_product_publication.sql` publie automatiquement
   un établissement dès qu'un produit actif lui est attribué ;
5. `20260716095047_white_label_data_api_privileges.sql` retire les écritures
   Data API directes sur les paniers, domaines et secrets d’établissement.

Les fichiers du dossier `Codes supabase` restent conservés comme référence
historique. Ils ne doivent pas être rejoués en plus de la migration de socle.

Après migration, exécuter les tests `supabase/tests/white_label_schema_smoke.sql`
et `supabase/tests/white_label_functional_smoke.sql`. Le test fonctionnel est
transactionnel et termine par un `rollback`.

## Connexion du site

Renseigner dans `web/assets/config.js` :

```js
window.IKIGAI_CONFIG = {
  supabaseUrl: "https://PROJET.supabase.co",
  supabasePublishableKey: "sb_publishable_...",
};
```

La cle publiee dans le navigateur est uniquement la cle `publishable`. La cle
`service_role` ne doit jamais etre ajoutee au depot.

## Premier SuperAdmin

1. Creer un compte depuis `marketplace/compte.html`.
2. Ouvrir `marketplace/admin.html` avec ce compte.
3. Cliquer sur **Initialiser le premier SuperAdmin**.

Cette action ne fonctionne que tant qu'aucun administrateur actif n'existe.

## Fonctions Supabase

Les fonctions se trouvent dans `supabase/functions` :

- `dispatch-livraison` : envoie une commande prete a IKIGAI Livraison ;
- `sync-livraisons` : recupere les statuts IKMS et envoie les emails en attente ;
- `inviter-membre` : variante avec envoi d'email automatique ;
- `paiement-webhook` : reception securisee d'un statut de paiement.

Le coeur du site fonctionne sans deployer `inviter-membre`, car l'interface
cree aussi des liens d'invitation directement via SQL.

Les cles IKMS des marchands et la cle Resend sont saisies depuis les interfaces
Marchand et SuperAdmin. Elles sont chiffrees dans Supabase Vault et ne sont
jamais renvoyees au navigateur.

Secrets encore utiles aux autres fonctions :

- `IDENTITY_APP_URL`
- `PAIEMENT_WEBHOOK_SECRET`

## Configuration IKMS

1. Dans **Administration > Livraisons**, renseigner l'URL de base `api-v1`,
   la page de creation des comptes pros et les codes de zones du tenant de
   livraison.
2. Dans le meme ecran, renseigner une cle Resend et un email expediteur dont le
   domaine est verifie, puis activer les emails de statut.
3. Chaque établissement ouvre **Espace marchand > Livraison**, crée ou récupère
   son compte client pro dans le tenant IKMS, puis enregistre sa propre clé
   `ik_live_...`, son adresse et sa zone de ramassage.

Le marchand confirme, prepare et marque la commande prete. La transmission a
IKMS cree ensuite la mission reelle. Seul le statut `LIVRE` retourne par IKMS
peut faire passer automatiquement la commande a `LIVREE`.

## Publication GitHub Pages

Le workflow `.github/workflows/pages.yml` publie automatiquement le dossier
`web` a chaque envoi sur la branche `main`.

Dans GitHub, ouvrir **Settings > Pages** et verifier que la source est
**GitHub Actions**.
