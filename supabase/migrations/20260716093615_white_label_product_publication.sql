-- Publier aussi une boutique lorsqu'un produit de Site dedie passe de
-- BROUILLON a ACTIF apres l'attribution de sa categorie privee.

drop trigger if exists publier_boutique_produit_actif on public.produits;
create trigger publier_boutique_produit_actif
after insert or update of statut on public.produits
for each row
when (new.statut = 'ACTIF')
execute function private.publier_boutique_produit_actif();
