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
- integration optionnelle avec IKIGAI Livraison ;
- application installable sur telephone.

## Installation Supabase depuis le tableau de bord

Pour un projet neuf, ouvrir l'editeur SQL Supabase et executer dans cet ordre :

1. `Codes supabase/migrations/20260711000100_identity.sql`
2. `Codes supabase/migrations/20260711000200_marketplace.sql`
3. `Codes supabase/migrations/20260711000300_marketplace_functions.sql`
4. `Codes supabase/migrations/20260711000400_storage.sql`
5. `Codes supabase/migrations/20260715000100_marketplace_operations.sql`

Pour le projet Ikigai Market actuel, les quatre premiers scripts sont deja en
place. Seul le cinquieme script constitue la mise a jour operationnelle.

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
- `inviter-membre` : variante avec envoi d'email automatique ;
- `paiement-webhook` : reception securisee d'un statut de paiement.

Le coeur du site fonctionne sans deployer `inviter-membre`, car l'interface
cree aussi des liens d'invitation directement via SQL.

Secrets utiles :

- `IDENTITY_APP_URL`
- `IKIGAI_LIVRAISON_API_URL`
- `IKIGAI_LIVRAISON_API_KEY`
- `PAIEMENT_WEBHOOK_SECRET`

## Publication GitHub Pages

Le workflow `.github/workflows/pages.yml` publie automatiquement le dossier
`web` a chaque envoi sur la branche `main`.

Dans GitHub, ouvrir **Settings > Pages** et verifier que la source est
**GitHub Actions**.
