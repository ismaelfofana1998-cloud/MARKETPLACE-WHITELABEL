# IKIGAI Market

Application e-commerce multi-boutiques reliee a Supabase et preparee pour la
livraison par IKIGAI Livraison.

Le projet est volontairement simple a publier : aucune compilation n'est
necessaire. GitHub Pages sert directement le dossier `web`.

## Ce qui est operationnel

- catalogue public, recherche, categories, boutiques et fiches produits ;
- compte client commun, profil, adresses, favoris et historique des commandes ;
- panier persistant, controle du stock et commande multi-boutiques ;
- paiement a la livraison ;
- espace marchand avec commandes en temps reel, catalogue, images et stock ;
- roles `PROPRIETAIRE`, `ADMIN`, `GESTIONNAIRE`, `AGENT` et `MEMBRE` ;
- espace SuperAdmin pour les tenants, boutiques, categories et le theme ;
- invitations par lien et initialisation unique du premier SuperAdmin ;
- integration IKMS par marchand avec cle API chiffree, suivi automatique et codes de livraison ;
- emails transactionnels persistants pour chaque statut de commande ;
- application installable sur telephone.

## Installation Supabase depuis le tableau de bord

Pour un projet neuf, ouvrir l'editeur SQL Supabase et executer dans cet ordre :

1. `Codes supabase/migrations/20260711000100_identity.sql`
2. `Codes supabase/migrations/20260711000200_marketplace.sql`
3. `Codes supabase/migrations/20260711000300_marketplace_functions.sql`
4. `Codes supabase/migrations/20260711000400_storage.sql`
5. `Codes supabase/migrations/20260715000100_marketplace_operations.sql`
6. `Codes supabase/migrations/20260715000200_marketplace_hardening.sql`
7. `Codes supabase/migrations/20260715000300_marketplace_rls_recursion_fix.sql`
8. `Codes supabase/migrations/20260715000400_publish_active_shops.sql`
9. `Codes supabase/migrations/20260715000500_catalog_search_guardrails.sql`
10. `Codes supabase/migrations/20260716000100_order_logistics_workflow.sql`

Le dernier script active la file d'emails, Supabase Vault, la synchronisation
IKMS et la tache automatique executee toutes les deux minutes.

Le test `Codes supabase/tests/schema_smoke.sql` peut ensuite etre execute dans
l'editeur SQL. Il ne modifie aucune donnee.

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
3. Chaque marchand ouvre **Espace marchand > Livraison**, cree ou recupere son
   compte client pro dans le tenant IKMS, puis enregistre sa propre cle
   `ik_live_...`, son adresse et sa zone de ramassage.

Le marchand confirme, prepare et marque la commande prete. La transmission a
IKMS cree ensuite la mission reelle. Seul le statut `LIVRE` retourne par IKMS
peut faire passer automatiquement la commande a `LIVREE`.

## Publication GitHub Pages

Le workflow `.github/workflows/pages.yml` publie automatiquement le dossier
`web` a chaque envoi sur la branche `main`.

Dans GitHub, ouvrir **Settings > Pages** et verifier que la source est
**GitHub Actions**.
