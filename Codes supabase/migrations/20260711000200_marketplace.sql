-- IKIGAI Marketplace - catalogue multi-boutiques, panier, commandes et logistique.

create table public.categories_marketplace (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories_marketplace(id) on delete set null,
  nom text not null,
  slug text not null unique,
  image_url text,
  ordre integer not null default 0,
  actif boolean not null default true
);

create table public.boutiques (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  nom text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  logo_url text,
  banniere_url text,
  telephone text,
  adresse text,
  statut text not null default 'BROUILLON' check (statut in ('BROUILLON', 'PUBLIEE', 'SUSPENDUE')),
  frais_livraison_base bigint not null default 1500 check (frais_livraison_base >= 0),
  note_moyenne numeric(3,2) not null default 0 check (note_moyenne between 0 and 5),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (organisation_id)
);

create table public.produits (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  categorie_id uuid references public.categories_marketplace(id) on delete set null,
  nom text not null,
  slug text not null,
  description text,
  prix bigint not null check (prix >= 0),
  prix_barre bigint check (prix_barre is null or prix_barre >= prix),
  images text[] not null default '{}',
  statut text not null default 'BROUILLON' check (statut in ('BROUILLON', 'ACTIF', 'EPUISE', 'ARCHIVE')),
  poids_grammes integer check (poids_grammes is null or poids_grammes >= 0),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (boutique_id, slug)
);

create table public.variantes_produit (
  id uuid primary key default gen_random_uuid(),
  produit_id uuid not null references public.produits(id) on delete cascade,
  sku text not null unique,
  nom text not null default 'Standard',
  attributs jsonb not null default '{}',
  prix bigint check (prix is null or prix >= 0),
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create table public.stocks (
  variante_id uuid primary key references public.variantes_produit(id) on delete cascade,
  quantite integer not null default 0 check (quantite >= 0),
  seuil_alerte integer not null default 5 check (seuil_alerte >= 0),
  modifie_le timestamptz not null default now()
);

create table public.adresses_livraison (
  id uuid primary key default gen_random_uuid(),
  identite_id uuid not null references public.identites(id) on delete cascade,
  libelle text not null default 'Domicile',
  destinataire_nom text not null,
  telephone text not null,
  adresse text not null,
  commune text,
  indications text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  principale boolean not null default false,
  cree_le timestamptz not null default now()
);

create table public.paniers (
  id uuid primary key default gen_random_uuid(),
  identite_id uuid not null references public.identites(id) on delete cascade,
  statut text not null default 'ACTIF' check (statut in ('ACTIF', 'VALIDE', 'ABANDONNE')),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create unique index paniers_actif_identite_idx on public.paniers(identite_id) where statut = 'ACTIF';

create table public.lignes_panier (
  id uuid primary key default gen_random_uuid(),
  panier_id uuid not null references public.paniers(id) on delete cascade,
  variante_id uuid not null references public.variantes_produit(id) on delete cascade,
  quantite integer not null check (quantite between 1 and 99),
  cree_le timestamptz not null default now(),
  unique (panier_id, variante_id)
);

create table public.achats (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  acheteur_id uuid not null references public.identites(id),
  adresse_livraison_id uuid not null references public.adresses_livraison(id),
  statut_paiement text not null default 'EN_ATTENTE' check (statut_paiement in ('EN_ATTENTE', 'PAYE', 'ECHOUE', 'REMBOURSE')),
  mode_paiement text not null check (mode_paiement in ('WAVE', 'ORANGE_MONEY', 'CARTE', 'A_LA_LIVRAISON')),
  sous_total bigint not null default 0,
  frais_livraison bigint not null default 0,
  total bigint not null default 0,
  cree_le timestamptz not null default now()
);

create table public.commandes_marketplace (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats(id) on delete cascade,
  boutique_id uuid not null references public.boutiques(id),
  reference text not null unique,
  statut text not null default 'NOUVELLE' check (statut in ('NOUVELLE', 'CONFIRMEE', 'EN_PREPARATION', 'PRETE', 'EN_LIVRAISON', 'LIVREE', 'ANNULEE')),
  sous_total bigint not null default 0,
  frais_livraison bigint not null default 0,
  total bigint not null default 0,
  note_client text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.lignes_commande_marketplace (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null references public.commandes_marketplace(id) on delete cascade,
  produit_id uuid not null references public.produits(id),
  variante_id uuid not null references public.variantes_produit(id),
  nom_produit text not null,
  nom_variante text not null,
  image_url text,
  prix_unitaire bigint not null check (prix_unitaire >= 0),
  quantite integer not null check (quantite > 0),
  total_ligne bigint generated always as (prix_unitaire * quantite) stored
);

create table public.paiements_marketplace (
  id uuid primary key default gen_random_uuid(),
  achat_id uuid not null references public.achats(id) on delete cascade,
  fournisseur text not null,
  reference_fournisseur text,
  montant bigint not null check (montant >= 0),
  statut text not null default 'INITIE' check (statut in ('INITIE', 'CONFIRME', 'ECHOUE', 'REMBOURSE')),
  cle_idempotence text not null unique,
  payload jsonb not null default '{}',
  cree_le timestamptz not null default now(),
  confirme_le timestamptz
);

create table public.avis_produits (
  id uuid primary key default gen_random_uuid(),
  produit_id uuid not null references public.produits(id) on delete cascade,
  identite_id uuid not null references public.identites(id) on delete cascade,
  note smallint not null check (note between 1 and 5),
  commentaire text,
  statut text not null default 'PUBLIE' check (statut in ('PUBLIE', 'MASQUE')),
  cree_le timestamptz not null default now(),
  unique (produit_id, identite_id)
);

create table public.integrations_livraison (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  code_entreprise_livraison text not null,
  compte_pro_externe_id uuid,
  actif boolean not null default true,
  modifie_le timestamptz not null default now()
);

create table public.missions_logistiques (
  id uuid primary key default gen_random_uuid(),
  commande_id uuid not null unique references public.commandes_marketplace(id) on delete cascade,
  entreprise_livraison_code text not null,
  compte_pro_externe_id uuid,
  commande_livraison_externe_id text,
  statut text not null default 'A_ENVOYER' check (statut in ('A_ENVOYER', 'ENVOYEE', 'ACCEPTEE', 'EN_COURS', 'LIVREE', 'ERREUR')),
  tentatives integer not null default 0,
  derniere_erreur text,
  payload jsonb not null default '{}',
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create index categories_parent_idx on public.categories_marketplace(parent_id) where parent_id is not null;
create index produits_boutique_statut_idx on public.produits(boutique_id, statut, cree_le desc);
create index produits_categorie_idx on public.produits(categorie_id) where categorie_id is not null;
create index produits_categorie_actif_idx on public.produits(categorie_id, cree_le desc) where statut = 'ACTIF';
create index variantes_produit_idx on public.variantes_produit(produit_id);
create index adresses_identite_idx on public.adresses_livraison(identite_id);
create index lignes_panier_panier_idx on public.lignes_panier(panier_id);
create index lignes_panier_variante_idx on public.lignes_panier(variante_id);
create index achats_acheteur_idx on public.achats(acheteur_id, cree_le desc);
create index achats_adresse_idx on public.achats(adresse_livraison_id);
create index commandes_achat_idx on public.commandes_marketplace(achat_id);
create index commandes_boutique_statut_idx on public.commandes_marketplace(boutique_id, statut, cree_le desc);
create index lignes_commande_commande_idx on public.lignes_commande_marketplace(commande_id);
create index lignes_commande_produit_idx on public.lignes_commande_marketplace(produit_id);
create index lignes_commande_variante_idx on public.lignes_commande_marketplace(variante_id);
create index paiements_achat_idx on public.paiements_marketplace(achat_id);
create index avis_produit_idx on public.avis_produits(produit_id, cree_le desc) where statut = 'PUBLIE';
create index missions_statut_idx on public.missions_logistiques(statut, cree_le) where statut in ('A_ENVOYER', 'ERREUR');

create trigger boutiques_toucher_modification before update on public.boutiques
for each row execute function private.toucher_modification();
create trigger produits_toucher_modification before update on public.produits
for each row execute function private.toucher_modification();
create trigger paniers_toucher_modification before update on public.paniers
for each row execute function private.toucher_modification();
create trigger commandes_marketplace_toucher_modification before update on public.commandes_marketplace
for each row execute function private.toucher_modification();
create trigger missions_toucher_modification before update on public.missions_logistiques
for each row execute function private.toucher_modification();

create or replace function private.peut_gerer_boutique(p_boutique_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.boutiques b
    where b.id = p_boutique_id
      and private.est_membre_organisation(
        b.organisation_id,
        array['PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE']
      )
  );
$$;

revoke all on function private.peut_gerer_boutique(uuid) from public, anon, authenticated;

alter table public.categories_marketplace enable row level security;
alter table public.boutiques enable row level security;
alter table public.produits enable row level security;
alter table public.variantes_produit enable row level security;
alter table public.stocks enable row level security;
alter table public.adresses_livraison enable row level security;
alter table public.paniers enable row level security;
alter table public.lignes_panier enable row level security;
alter table public.achats enable row level security;
alter table public.commandes_marketplace enable row level security;
alter table public.lignes_commande_marketplace enable row level security;
alter table public.paiements_marketplace enable row level security;
alter table public.avis_produits enable row level security;
alter table public.integrations_livraison enable row level security;
alter table public.missions_logistiques enable row level security;

create policy categories_publiques on public.categories_marketplace for select to anon, authenticated using (actif);
create policy categories_admin on public.categories_marketplace for all to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));
create policy boutiques_publiques on public.boutiques for select to anon, authenticated using (statut = 'PUBLIEE');
create policy boutiques_admin_lecture on public.boutiques for select to authenticated using ((select private.est_admin_plateforme(null)));
create policy boutiques_admin_modification on public.boutiques for update to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])));
create policy boutiques_gestionnaires_lecture on public.boutiques for select to authenticated using ((select private.peut_gerer_boutique(id)));
create policy boutiques_gestionnaires_modification on public.boutiques for update to authenticated
using ((select private.peut_gerer_boutique(id))) with check ((select private.peut_gerer_boutique(id)));

create policy produits_publics on public.produits for select to anon, authenticated
using (statut in ('ACTIF', 'EPUISE') and exists (select 1 from public.boutiques b where b.id = boutique_id and b.statut = 'PUBLIEE'));
create policy produits_gestionnaires_lecture on public.produits for select to authenticated using ((select private.peut_gerer_boutique(boutique_id)));
create policy produits_gestionnaires_creation on public.produits for insert to authenticated with check ((select private.peut_gerer_boutique(boutique_id)));
create policy produits_gestionnaires_modification on public.produits for update to authenticated
using ((select private.peut_gerer_boutique(boutique_id))) with check ((select private.peut_gerer_boutique(boutique_id)));
create policy produits_gestionnaires_suppression on public.produits for delete to authenticated using ((select private.peut_gerer_boutique(boutique_id)));
create policy produits_admin_lecture on public.produits for select to authenticated using ((select private.est_admin_plateforme(null)));
create policy produits_admin_modification on public.produits for update to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

create policy variantes_publiques on public.variantes_produit for select to anon, authenticated
using (actif and exists (select 1 from public.produits p where p.id = produit_id and p.statut in ('ACTIF', 'EPUISE')));
create policy variantes_gestionnaires on public.variantes_produit for all to authenticated
using (exists (select 1 from public.produits p where p.id = produit_id and private.peut_gerer_boutique(p.boutique_id)))
with check (exists (select 1 from public.produits p where p.id = produit_id and private.peut_gerer_boutique(p.boutique_id)));

create policy stocks_publics on public.stocks for select to anon, authenticated using (true);
create policy stocks_gestionnaires on public.stocks for all to authenticated
using (exists (select 1 from public.variantes_produit v join public.produits p on p.id = v.produit_id where v.id = variante_id and private.peut_gerer_boutique(p.boutique_id)))
with check (exists (select 1 from public.variantes_produit v join public.produits p on p.id = v.produit_id where v.id = variante_id and private.peut_gerer_boutique(p.boutique_id)));

create policy adresses_proprietaire on public.adresses_livraison for all to authenticated
using (identite_id = (select auth.uid())) with check (identite_id = (select auth.uid()));
create policy paniers_proprietaire on public.paniers for all to authenticated
using (identite_id = (select auth.uid())) with check (identite_id = (select auth.uid()));
create policy lignes_panier_proprietaire on public.lignes_panier for all to authenticated
using (exists (select 1 from public.paniers p where p.id = panier_id and p.identite_id = (select auth.uid())))
with check (exists (select 1 from public.paniers p where p.id = panier_id and p.identite_id = (select auth.uid())));

create policy achats_acheteur on public.achats for select to authenticated using (acheteur_id = (select auth.uid()));
create policy commandes_acheteur on public.commandes_marketplace for select to authenticated
using (exists (select 1 from public.achats a where a.id = achat_id and a.acheteur_id = (select auth.uid())));
create policy commandes_marchand on public.commandes_marketplace for select to authenticated using ((select private.peut_gerer_boutique(boutique_id)));
create policy lignes_commande_acheteur_marchand on public.lignes_commande_marketplace for select to authenticated
using (exists (select 1 from public.commandes_marketplace c join public.achats a on a.id = c.achat_id where c.id = commande_id and (a.acheteur_id = (select auth.uid()) or private.peut_gerer_boutique(c.boutique_id))));
create policy paiements_acheteur on public.paiements_marketplace for select to authenticated
using (exists (select 1 from public.achats a where a.id = achat_id and a.acheteur_id = (select auth.uid())));

create policy avis_publics on public.avis_produits for select to anon, authenticated using (statut = 'PUBLIE');
create policy avis_creation_acheteur on public.avis_produits for insert to authenticated
with check (identite_id = (select auth.uid()) and exists (
  select 1 from public.lignes_commande_marketplace l
  join public.commandes_marketplace c on c.id = l.commande_id
  join public.achats a on a.id = c.achat_id
  where l.produit_id = avis_produits.produit_id and a.acheteur_id = (select auth.uid()) and c.statut = 'LIVREE'
));
create policy avis_modification_soi on public.avis_produits for update to authenticated
using (identite_id = (select auth.uid())) with check (identite_id = (select auth.uid()));

create policy integrations_gestionnaires on public.integrations_livraison for all to authenticated
using ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])))
with check ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])));
create policy missions_acheteur_marchand on public.missions_logistiques for select to authenticated
using (exists (select 1 from public.commandes_marketplace c join public.achats a on a.id = c.achat_id where c.id = commande_id and (a.acheteur_id = (select auth.uid()) or private.peut_gerer_boutique(c.boutique_id))));
create policy missions_admin on public.missions_logistiques for all to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])));

grant select on public.categories_marketplace, public.boutiques, public.produits, public.variantes_produit, public.stocks, public.avis_produits to anon, authenticated;
grant insert, update, delete on public.boutiques, public.produits, public.variantes_produit, public.stocks to authenticated;
grant insert, update, delete on public.categories_marketplace to authenticated;
grant select, insert, update, delete on public.adresses_livraison, public.paniers, public.lignes_panier to authenticated;
grant select on public.achats, public.commandes_marketplace, public.lignes_commande_marketplace, public.paiements_marketplace, public.missions_logistiques to authenticated;
grant update on public.missions_logistiques to authenticated;
grant insert, update on public.avis_produits, public.integrations_livraison to authenticated;
