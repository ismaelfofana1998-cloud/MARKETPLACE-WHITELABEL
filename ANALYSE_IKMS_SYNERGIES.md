# Contrat d'integration entre Marketplace et IKMS

## Decision d'architecture

Marketplace et IKMS sont deux applications independantes.

- Marketplace gere l'identite client, le catalogue, le panier, la commande,
  le paiement, les annulations, les retours commerciaux et son propre suivi.
- IKMS gere ses entreprises clientes, ses operations logistiques et son propre
  suivi.
- Aucun ecran, aucune table et aucune machine a etats ne sont partages entre
  les deux applications.

La connexion technique est limitee au gateway partenaire `api-v1` :

1. `POST /commandes` cree une demande de livraison.
2. `GET /commandes/:id` fournit le statut courant des colis.
3. `GET /tarifs` fournit la grille tarifaire complete de l'entreprise et sert
   aussi de referentiel de zones cote Marketplace.

Les cles `ik_live_...` restent cote serveur. Marketplace ne lit jamais
directement une table ou une RPC interne d'IKMS.

## Suivi Marketplace

Le client ne voit que quatre jalons metier :

- `Commande confirmee`
- `Confiee au livreur`
- `Livree`
- `Annulee`

Les statuts techniques recus par `GET /commandes/:id` sont traduits localement
vers ces jalons. Ils ne sont pas affiches directement au client.

Le suivi reste dans l'espace authentifie du client. Il n'existe pas de page
publique par jeton, de partage GPS, ni d'exposition publique des codes de
ramassage ou de livraison.

## Tarifs et zones

`GET /tarifs` est charge au maximum une fois par heure et par boutique dans la
memoire de l'Edge Function. Les paires de zones sont symetriques.

Le calcul indicatif utilise :

- la zone de depart du marchand ;
- la zone habituelle du client ;
- la zone choisie au checkout lorsque le client souhaite etre livre ailleurs.

Le prix affiche avant validation reste une estimation. Seul
`data.colis[].montant_livraison` retourne par `POST /commandes` fait foi pour
la livraison effectivement creee.

Une cle `ik_live_...` de catalogue est configuree une seule fois dans
l'administration Marketplace. `zones-ikms` l'utilise pour extraire les zones
distinctes de la grille sans persister la grille ni le cache en base. La liste
est utilisee a l'inscription, dans les adresses client, pour la zone de
ramassage du marchand et au checkout.

Lors de l'ouverture d'une boutique, le marchand choisit deja sa zone et
renseigne les coordonnees de ramassage. L'integration reste inactive jusqu'a
l'ajout de sa cle professionnelle IKMS dans l'espace **Livraison**.

Le catalogue et le panier n'effectuent aucun calcul distant. Ils affichent
seulement « livraison a partir de ». Le calcul reel est lance au checkout,
puis reverifie cote serveur avant la validation du panier.

## Indicateurs marchands conserves

Marketplace peut calculer avec les donnees qu'elle a deja recues :

- les missions en cours ;
- les commandes livrees ;
- le taux de livraison ;
- les retours et incidents ;
- l'ecart entre les frais factures au client et
  `colis[].montant_livraison`.

Ces indicateurs sont locaux a Marketplace et ne constituent pas un acces au
systeme interne d'IKMS.

## Limites a conserver

- Aucun GPS IKMS dans Marketplace.
- Aucun evenement interne IKMS expose au client.
- Aucun acces direct a la base IKMS.
- Aucun partage de tables, de comptes ou de suivi entre les applications.
- Aucun recalcul du panier ou du stock dans IKMS.
- Aucun remboursement automatique declenche uniquement par un statut
  logistique.
- Aucun nouveau endpoint IKMS suppose sans ajout explicite au contrat
  `api-v1`.
