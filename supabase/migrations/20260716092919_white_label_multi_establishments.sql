-- Socle Marketplace historique fige pour le nouveau projet White Label.
-- Copie reproductible des migrations validees, dans leur ordre d'origine.

-- >>> DEBUT SOCLE 20260711000100_identity.sql
-- IKIGAI Identity - identite globale, organisations et droits multi-organisations.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
set search_path = public, extensions;
create schema if not exists private;

create table public.identites (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext unique,
  prenom text,
  nom text,
  telephone text,
  avatar_url text,
  langue text not null default 'fr' check (langue in ('fr', 'en')),
  organisation_active_id uuid,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(trim(nom)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  type text not null check (type in ('LOGISTIQUE', 'PRESSING', 'MARCHAND', 'RESTAURANT', 'AUTRE')),
  pays char(2) not null default 'CI',
  devise char(3) not null default 'XOF',
  logo_url text,
  actif boolean not null default true,
  cree_par uuid not null references public.identites(id),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

alter table public.identites
  add constraint identites_organisation_active_fkey
  foreign key (organisation_active_id) references public.organisations(id) on delete set null;

create table public.membres_organisation (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  identite_id uuid not null references public.identites(id) on delete cascade,
  role text not null check (role in ('PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE', 'AGENT', 'MEMBRE')),
  statut text not null default 'ACTIF' check (statut in ('ACTIF', 'SUSPENDU')),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  primary key (organisation_id, identite_id)
);

create table public.invitations_organisation (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  email citext not null,
  role text not null check (role in ('ADMIN', 'GESTIONNAIRE', 'AGENT', 'MEMBRE')),
  token uuid not null default gen_random_uuid() unique,
  statut text not null default 'EN_ATTENTE' check (statut in ('EN_ATTENTE', 'ACCEPTEE', 'EXPIREE', 'ANNULEE')),
  invite_par uuid not null references public.identites(id),
  expire_le timestamptz not null default (now() + interval '7 days'),
  cree_le timestamptz not null default now()
);

create table public.administrateurs_plateforme (
  identite_id uuid primary key references public.identites(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN', 'SUPPORT', 'CATALOGUE')),
  actif boolean not null default true,
  cree_le timestamptz not null default now()
);

create index identites_organisation_active_idx on public.identites(organisation_active_id);
create index organisations_cree_par_idx on public.organisations(cree_par);
create index membres_identite_idx on public.membres_organisation(identite_id, statut);
create index membres_organisation_role_idx on public.membres_organisation(organisation_id, role) where statut = 'ACTIF';
create index invitations_organisation_statut_idx on public.invitations_organisation(organisation_id, statut, expire_le);
create index invitations_invite_par_idx on public.invitations_organisation(invite_par);

create or replace function private.toucher_modification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

create or replace function private.creer_identite_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.identites (id, email, prenom, nom, telephone)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'prenom'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'nom'), ''),
    nullif(trim(coalesce(new.phone, new.raw_user_meta_data ->> 'telephone')), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger identites_toucher_modification
before update on public.identites
for each row execute function private.toucher_modification();

create trigger organisations_toucher_modification
before update on public.organisations
for each row execute function private.toucher_modification();

create trigger membres_toucher_modification
before update on public.membres_organisation
for each row execute function private.toucher_modification();

create trigger auth_creer_identite
after insert or update of email on auth.users
for each row execute function private.creer_identite_auth();

create or replace function private.est_membre_organisation(
  p_organisation_id uuid,
  p_roles text[] default null
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.membres_organisation m
    where m.organisation_id = p_organisation_id
      and m.identite_id = (select auth.uid())
      and m.statut = 'ACTIF'
      and (p_roles is null or m.role = any(p_roles))
  );
$$;

create or replace function private.est_admin_plateforme(p_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.administrateurs_plateforme a
    where a.identite_id = (select auth.uid()) and a.actif
      and (p_roles is null or a.role = any(p_roles))
  );
$$;

revoke all on function private.est_membre_organisation(uuid, text[]) from public, anon, authenticated;
revoke all on function private.est_admin_plateforme(text[]) from public, anon, authenticated;

create or replace function public.rpc_creer_organisation(
  p_nom text,
  p_slug text,
  p_type text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_organisation uuid;
begin
  if v_utilisateur is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if p_type not in ('LOGISTIQUE', 'PRESSING', 'MARCHAND', 'RESTAURANT', 'AUTRE') then
    raise exception 'Type d''organisation invalide.';
  end if;

  insert into public.organisations (nom, slug, type, cree_par)
  values (trim(p_nom), lower(trim(p_slug)), p_type, v_utilisateur)
  returning id into v_organisation;

  insert into public.membres_organisation (organisation_id, identite_id, role)
  values (v_organisation, v_utilisateur, 'PROPRIETAIRE');

  update public.identites
  set organisation_active_id = coalesce(organisation_active_id, v_organisation)
  where id = v_utilisateur;

  return v_organisation;
end;
$$;

create or replace function public.rpc_accepter_invitation(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_email text;
  v_invitation public.invitations_organisation%rowtype;
begin
  if v_utilisateur is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  select email into v_email from auth.users where id = v_utilisateur;
  select * into v_invitation
  from public.invitations_organisation
  where token = p_token and statut = 'EN_ATTENTE'
  for update;

  if v_invitation.id is null or v_invitation.expire_le <= now() then
    raise exception 'Invitation absente ou expiree.';
  end if;
  if lower(v_invitation.email::text) <> lower(v_email::text) then
    raise exception 'Cette invitation appartient a une autre adresse.' using errcode = '42501';
  end if;

  insert into public.membres_organisation (organisation_id, identite_id, role)
  values (v_invitation.organisation_id, v_utilisateur, v_invitation.role)
  on conflict (organisation_id, identite_id)
  do update set role = excluded.role, statut = 'ACTIF', modifie_le = now();

  update public.invitations_organisation set statut = 'ACCEPTEE' where id = v_invitation.id;
  update public.identites set organisation_active_id = v_invitation.organisation_id where id = v_utilisateur;
  return v_invitation.organisation_id;
end;
$$;

revoke all on function public.rpc_creer_organisation(text, text, text) from public, anon;
revoke all on function public.rpc_accepter_invitation(uuid) from public, anon;
grant execute on function public.rpc_creer_organisation(text, text, text) to authenticated;
grant execute on function public.rpc_accepter_invitation(uuid) to authenticated;

alter table public.identites enable row level security;
alter table public.organisations enable row level security;
alter table public.membres_organisation enable row level security;
alter table public.invitations_organisation enable row level security;
alter table public.administrateurs_plateforme enable row level security;

create policy identites_lecture_soi on public.identites
for select to authenticated
using (id = (select auth.uid()));

create policy identites_lecture_collegues on public.identites
for select to authenticated
using (exists (
  select 1 from public.membres_organisation cible
  where cible.identite_id = identites.id
    and (select private.est_membre_organisation(cible.organisation_id, null))
));

create policy identites_modifier_soi on public.identites
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organisations_lecture_membres on public.organisations
for select to authenticated
using ((select private.est_membre_organisation(id, null)));

create policy organisations_modifier_admin on public.organisations
for update to authenticated
using ((select private.est_membre_organisation(id, array['PROPRIETAIRE', 'ADMIN'])))
with check ((select private.est_membre_organisation(id, array['PROPRIETAIRE', 'ADMIN'])));

create policy membres_lecture_organisation on public.membres_organisation
for select to authenticated
using (identite_id = (select auth.uid()) or (select private.est_membre_organisation(organisation_id, null)));

create policy membres_ajout_admin on public.membres_organisation
for insert to authenticated
with check ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])));

create policy membres_modification_admin on public.membres_organisation
for update to authenticated
using ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])))
with check ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])));

create policy membres_suppression_admin on public.membres_organisation
for delete to authenticated
using (
  identite_id <> (select auth.uid())
  and (select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN']))
);

create policy invitations_lecture_admin on public.invitations_organisation
for select to authenticated
using ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])));

create policy invitations_creation_admin on public.invitations_organisation
for insert to authenticated
with check (
  invite_par = (select auth.uid())
  and (select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN']))
);

create policy invitations_modification_admin on public.invitations_organisation
for update to authenticated
using ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])))
with check ((select private.est_membre_organisation(organisation_id, array['PROPRIETAIRE', 'ADMIN'])));

create policy administrateurs_lecture_soi on public.administrateurs_plateforme
for select to authenticated
using (identite_id = (select auth.uid()));

grant select, update on public.identites to authenticated;
grant select, update on public.organisations to authenticated;
grant select, insert, update, delete on public.membres_organisation to authenticated;
grant select, insert, update on public.invitations_organisation to authenticated;
grant select on public.administrateurs_plateforme to authenticated;
-- <<< FIN SOCLE 20260711000100_identity.sql

-- >>> DEBUT SOCLE 20260711000200_marketplace.sql
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
-- <<< FIN SOCLE 20260711000200_marketplace.sql

-- >>> DEBUT SOCLE 20260711000300_marketplace_functions.sql
-- Fonctions transactionnelles Marketplace. Les prix et stocks sont recalcules
-- cote base : le navigateur ne peut jamais imposer un montant.

create or replace function public.rpc_ajouter_au_panier(
  p_variante_id uuid,
  p_quantite integer default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_panier uuid;
  v_stock integer;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if p_quantite < 1 or p_quantite > 99 then raise exception 'Quantite invalide.'; end if;

  select s.quantite into v_stock
  from public.stocks s
  join public.variantes_produit v on v.id = s.variante_id and v.actif
  join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
  join public.boutiques b on b.id = p.boutique_id and b.statut = 'PUBLIEE'
  where s.variante_id = p_variante_id;

  if v_stock is null then raise exception 'Produit indisponible.'; end if;
  if v_stock < p_quantite then raise exception 'Stock insuffisant.'; end if;

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF';

  if v_panier is null then
    insert into public.paniers (identite_id) values (v_utilisateur) returning id into v_panier;
  end if;

  insert into public.lignes_panier (panier_id, variante_id, quantite)
  values (v_panier, p_variante_id, p_quantite)
  on conflict (panier_id, variante_id)
  do update set quantite = least(99, public.lignes_panier.quantite + excluded.quantite);

  if (select quantite from public.lignes_panier where panier_id = v_panier and variante_id = p_variante_id) > v_stock then
    raise exception 'Stock insuffisant.';
  end if;
  return v_panier;
end;
$$;

create or replace function public.rpc_modifier_ligne_panier(
  p_ligne_id uuid,
  p_quantite integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_stock integer;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.lignes_panier l join public.paniers p on p.id = l.panier_id
    where l.id = p_ligne_id and p.identite_id = v_utilisateur and p.statut = 'ACTIF'
  ) then raise exception 'Ligne introuvable.' using errcode = '42501'; end if;

  if p_quantite <= 0 then
    delete from public.lignes_panier where id = p_ligne_id;
    return;
  end if;

  select s.quantite into v_stock
  from public.lignes_panier l join public.stocks s on s.variante_id = l.variante_id
  where l.id = p_ligne_id;
  if p_quantite > coalesce(v_stock, 0) then raise exception 'Stock insuffisant.'; end if;
  update public.lignes_panier set quantite = p_quantite where id = p_ligne_id;
end;
$$;

create or replace function public.rpc_valider_panier(
  p_adresse_id uuid,
  p_mode_paiement text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
  v_panier uuid;
  v_achat uuid;
  v_commande uuid;
  v_boutique record;
  v_ligne record;
  v_sous_total bigint;
  v_total_achat bigint := 0;
  v_frais_achat bigint := 0;
  v_reference text;
begin
  if v_utilisateur is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if p_mode_paiement not in ('WAVE', 'ORANGE_MONEY', 'CARTE', 'A_LA_LIVRAISON') then
    raise exception 'Mode de paiement invalide.';
  end if;
  if not exists (select 1 from public.adresses_livraison where id = p_adresse_id and identite_id = v_utilisateur) then
    raise exception 'Adresse invalide.' using errcode = '42501';
  end if;

  select id into v_panier from public.paniers
  where identite_id = v_utilisateur and statut = 'ACTIF' for update;
  if v_panier is null or not exists (select 1 from public.lignes_panier where panier_id = v_panier) then
    raise exception 'Le panier est vide.';
  end if;

  v_reference := 'ACH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.achats (reference, acheteur_id, adresse_livraison_id, mode_paiement)
  values (v_reference, v_utilisateur, p_adresse_id, p_mode_paiement)
  returning id into v_achat;

  for v_boutique in
    select distinct b.id, b.frais_livraison_base
    from public.lignes_panier lp
    join public.variantes_produit v on v.id = lp.variante_id
    join public.produits p on p.id = v.produit_id
    join public.boutiques b on b.id = p.boutique_id
    where lp.panier_id = v_panier and p.statut = 'ACTIF' and b.statut = 'PUBLIEE'
  loop
    v_sous_total := 0;
    insert into public.commandes_marketplace
      (achat_id, boutique_id, reference, frais_livraison, note_client)
    values
      (v_achat, v_boutique.id, 'CMD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), v_boutique.frais_livraison_base, p_note)
    returning id into v_commande;

    for v_ligne in
      select lp.quantite, v.id as variante_id, v.nom as variante_nom,
             p.id as produit_id, p.nom as produit_nom, p.images,
             coalesce(v.prix, p.prix) as prix, s.quantite as stock
      from public.lignes_panier lp
      join public.variantes_produit v on v.id = lp.variante_id and v.actif
      join public.produits p on p.id = v.produit_id and p.statut = 'ACTIF'
      join public.stocks s on s.variante_id = v.id
      where lp.panier_id = v_panier and p.boutique_id = v_boutique.id
      for update of s
    loop
      if v_ligne.stock < v_ligne.quantite then
        raise exception 'Stock insuffisant pour %.', v_ligne.produit_nom;
      end if;

      update public.stocks set quantite = quantite - v_ligne.quantite, modifie_le = now()
      where variante_id = v_ligne.variante_id;

      insert into public.lignes_commande_marketplace
        (commande_id, produit_id, variante_id, nom_produit, nom_variante, image_url, prix_unitaire, quantite)
      values
        (v_commande, v_ligne.produit_id, v_ligne.variante_id, v_ligne.produit_nom,
         v_ligne.variante_nom, v_ligne.images[1], v_ligne.prix, v_ligne.quantite);

      v_sous_total := v_sous_total + (v_ligne.prix * v_ligne.quantite);
    end loop;

    if v_sous_total = 0 then raise exception 'Une boutique du panier ne contient plus de produit disponible.'; end if;
    update public.commandes_marketplace
    set sous_total = v_sous_total, total = v_sous_total + v_boutique.frais_livraison_base
    where id = v_commande;
    v_total_achat := v_total_achat + v_sous_total;
    v_frais_achat := v_frais_achat + v_boutique.frais_livraison_base;
  end loop;

  if v_total_achat = 0 then raise exception 'Aucun produit disponible dans le panier.'; end if;
  update public.achats
  set sous_total = v_total_achat, frais_livraison = v_frais_achat, total = v_total_achat + v_frais_achat
  where id = v_achat;

  insert into public.paiements_marketplace
    (achat_id, fournisseur, montant, cle_idempotence)
  values
    (v_achat, p_mode_paiement, v_total_achat + v_frais_achat, v_achat::text || ':initial');

  update public.paniers set statut = 'VALIDE' where id = v_panier;
  return v_achat;
end;
$$;

create or replace function public.rpc_changer_statut_commande_marketplace(
  p_commande_id uuid,
  p_nouveau_statut text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande public.commandes_marketplace%rowtype;
  v_autorise boolean := false;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  select * into v_commande from public.commandes_marketplace where id = p_commande_id for update;
  if v_commande.id is null or not private.peut_gerer_boutique(v_commande.boutique_id) then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;

  v_autorise := case v_commande.statut
    when 'NOUVELLE' then p_nouveau_statut in ('CONFIRMEE', 'ANNULEE')
    when 'CONFIRMEE' then p_nouveau_statut in ('EN_PREPARATION', 'ANNULEE')
    when 'EN_PREPARATION' then p_nouveau_statut = 'PRETE'
    when 'PRETE' then p_nouveau_statut = 'EN_LIVRAISON'
    when 'EN_LIVRAISON' then p_nouveau_statut = 'LIVREE'
    else false end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  update public.commandes_marketplace set statut = p_nouveau_statut where id = p_commande_id;
end;
$$;

create or replace function public.rpc_creer_boutique_marketplace(
  p_organisation_id uuid,
  p_nom text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN']) then
    raise exception 'Droit administrateur requis.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id and type in ('MARCHAND', 'RESTAURANT')) then
    raise exception 'Cette organisation n''est pas marchande.';
  end if;
  insert into public.boutiques (organisation_id, nom, slug)
  values (p_organisation_id, trim(p_nom), lower(trim(p_slug)))
  returning id into v_boutique;
  return v_boutique;
end;
$$;

create or replace function public.rpc_creer_produit_marketplace(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_image_url text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
  v_variante uuid;
  v_slug text;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not private.peut_gerer_boutique(p_boutique_id) then raise exception 'Droit marchand requis.' using errcode = '42501'; end if;
  if p_prix < 0 or p_stock < 0 then raise exception 'Prix ou stock invalide.'; end if;
  v_slug := lower(regexp_replace(trim(p_nom), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.produits (boutique_id, nom, slug, prix, images, statut)
  values (p_boutique_id, trim(p_nom), v_slug, p_prix, case when p_image_url is null then array[]::text[] else array[p_image_url] end, 'ACTIF')
  returning id into v_produit;
  insert into public.variantes_produit (produit_id, sku, nom)
  values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
  returning id into v_variante;
  insert into public.stocks (variante_id, quantite) values (v_variante, p_stock);
  return v_produit;
end;
$$;

revoke all on function public.rpc_ajouter_au_panier(uuid, integer) from public, anon;
revoke all on function public.rpc_modifier_ligne_panier(uuid, integer) from public, anon;
revoke all on function public.rpc_valider_panier(uuid, text, text) from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text) from public, anon;
revoke all on function public.rpc_creer_boutique_marketplace(uuid, text, text) from public, anon;
revoke all on function public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text) from public, anon;
grant execute on function public.rpc_ajouter_au_panier(uuid, integer) to authenticated;
grant execute on function public.rpc_modifier_ligne_panier(uuid, integer) to authenticated;
grant execute on function public.rpc_valider_panier(uuid, text, text) to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text) to authenticated;
grant execute on function public.rpc_creer_boutique_marketplace(uuid, text, text) to authenticated;
grant execute on function public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text) to authenticated;
-- <<< FIN SOCLE 20260711000300_marketplace_functions.sql

-- >>> DEBUT SOCLE 20260711000400_storage.sql
-- Medias publics de boutiques et produits.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace', 'marketplace', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy marketplace_medias_lecture on storage.objects
for select to anon, authenticated
using (bucket_id = 'marketplace');

create policy marketplace_medias_creation on storage.objects
for insert to authenticated
with check (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] in (
    select b.id::text from public.boutiques b where private.peut_gerer_boutique(b.id)
  )
);
create policy marketplace_medias_modification on storage.objects
for update to authenticated
using (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] in (
    select b.id::text from public.boutiques b where private.peut_gerer_boutique(b.id)
  )
)
with check (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] in (
    select b.id::text from public.boutiques b where private.peut_gerer_boutique(b.id)
  )
);

create policy marketplace_medias_suppression on storage.objects
for delete to authenticated
using (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] in (
    select b.id::text from public.boutiques b where private.peut_gerer_boutique(b.id)
  )
);
-- <<< FIN SOCLE 20260711000400_storage.sql

-- >>> DEBUT SOCLE 20260715000100_marketplace_operations.sql
-- IKIGAI Market - mise a niveau operationnelle.
-- Cette migration est idempotente et peut etre collee telle quelle dans
-- l'editeur SQL Supabase apres les migrations 20260711000100 a 00400.

set search_path = public, extensions;

alter table public.categories_marketplace
  add column if not exists description text;

alter table public.boutiques
  add column if not exists email_contact text,
  add column if not exists whatsapp text,
  add column if not exists delai_preparation_minutes integer not null default 60,
  add column if not exists horaires jsonb not null default '{}'::jsonb;

alter table public.produits
  add column if not exists marque text,
  add column if not exists tags text[] not null default '{}';

alter table public.commandes_marketplace
  add column if not exists vue_le timestamptz,
  add column if not exists annulee_par uuid references public.identites(id) on delete set null,
  add column if not exists motif_annulation text;

create table if not exists public.configuration_marketplace (
  id smallint primary key default 1 check (id = 1),
  nom text not null default 'IKIGAI Market',
  slogan text not null default 'Les boutiques d''ici, livrees par IKIGAI.',
  description text not null default 'Achetez aupres de commerces locaux et suivez chaque livraison.',
  logo_url text,
  hero_image_url text not null default 'https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=1800&q=86',
  couleur_primaire text not null default '#C75332' check (couleur_primaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_secondaire text not null default '#17211F' check (couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_accent text not null default '#E9AE36' check (couleur_accent ~ '^#[0-9A-Fa-f]{6}$'),
  email_support text,
  telephone_support text,
  modifie_le timestamptz not null default now()
);

insert into public.configuration_marketplace (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.favoris_marketplace (
  identite_id uuid not null references public.identites(id) on delete cascade,
  produit_id uuid not null references public.produits(id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (identite_id, produit_id)
);

create table if not exists public.historique_statuts_commande (
  id bigint generated always as identity primary key,
  commande_id uuid not null references public.commandes_marketplace(id) on delete cascade,
  ancien_statut text,
  nouveau_statut text not null,
  change_par uuid references public.identites(id) on delete set null,
  note text,
  cree_le timestamptz not null default now()
);

create index if not exists favoris_produit_idx
  on public.favoris_marketplace(produit_id);
create index if not exists historique_commande_date_idx
  on public.historique_statuts_commande(commande_id, cree_le desc);

drop trigger if exists configuration_marketplace_toucher_modification on public.configuration_marketplace;
create trigger configuration_marketplace_toucher_modification
before update on public.configuration_marketplace
for each row execute function private.toucher_modification();

create or replace function private.peut_operer_boutique(p_boutique_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.boutiques b
    where b.id = p_boutique_id
      and private.est_membre_organisation(
        b.organisation_id,
        array['PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE', 'AGENT']
      )
  );
$$;

revoke all on function private.peut_operer_boutique(uuid)
from public, anon, authenticated;

-- Les helpers restent hors des schemas exposes par PostgREST. Le role
-- authenticated doit toutefois pouvoir les invoquer pendant l'evaluation RLS.
grant usage on schema private to authenticated;
grant execute on function private.est_membre_organisation(uuid, text[]) to authenticated;
grant execute on function private.est_admin_plateforme(text[]) to authenticated;
grant execute on function private.peut_gerer_boutique(uuid) to authenticated;
grant execute on function private.peut_operer_boutique(uuid) to authenticated;

create or replace function private.journaliser_statut_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.statut is distinct from new.statut then
    insert into public.historique_statuts_commande
      (commande_id, ancien_statut, nouveau_statut, change_par, note)
    values
      (new.id, case when tg_op = 'INSERT' then null else old.statut end,
       new.statut, (select auth.uid()), new.motif_annulation);
  end if;
  return new;
end;
$$;

drop trigger if exists commandes_marketplace_historique on public.commandes_marketplace;
create trigger commandes_marketplace_historique
after insert or update of statut on public.commandes_marketplace
for each row execute function private.journaliser_statut_commande();

create or replace function private.synchroniser_commande_annulee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_frais bigint;
begin
  if old.statut is distinct from 'ANNULEE' and new.statut = 'ANNULEE' then
    update public.stocks s
    set quantite = s.quantite + lignes.quantite,
        modifie_le = now()
    from (
      select variante_id, sum(quantite)::integer as quantite
      from public.lignes_commande_marketplace
      where commande_id = new.id
      group by variante_id
    ) lignes
    where s.variante_id = lignes.variante_id;
  end if;

  select coalesce(sum(sous_total), 0), coalesce(sum(frais_livraison), 0)
  into v_total, v_frais
  from public.commandes_marketplace
  where achat_id = new.achat_id and statut <> 'ANNULEE';

  update public.achats
  set sous_total = v_total,
      frais_livraison = v_frais,
      total = v_total + v_frais,
      statut_paiement = case
        when v_total + v_frais = 0 then 'ECHOUE'
        when mode_paiement = 'A_LA_LIVRAISON'
             and not exists (
               select 1 from public.commandes_marketplace
               where achat_id = new.achat_id and statut not in ('LIVREE', 'ANNULEE')
             ) then 'PAYE'
        else statut_paiement
      end
  where id = new.achat_id;

  update public.paiements_marketplace p
  set montant = v_total + v_frais,
      statut = case
        when v_total + v_frais = 0 then 'ECHOUE'
        when exists (
          select 1 from public.achats a
          where a.id = new.achat_id and a.statut_paiement = 'PAYE'
        ) then 'CONFIRME'
        else p.statut
      end,
      confirme_le = case
        when exists (
          select 1 from public.achats a
          where a.id = new.achat_id and a.statut_paiement = 'PAYE'
        ) then coalesce(p.confirme_le, now())
        else p.confirme_le
      end
  where p.achat_id = new.achat_id;

  return new;
end;
$$;

drop trigger if exists commandes_marketplace_synchroniser on public.commandes_marketplace;
create trigger commandes_marketplace_synchroniser
after update of statut on public.commandes_marketplace
for each row execute function private.synchroniser_commande_annulee();

insert into public.historique_statuts_commande
  (commande_id, ancien_statut, nouveau_statut, change_par, cree_le)
select c.id, null, c.statut, null, c.cree_le
from public.commandes_marketplace c
where not exists (
  select 1 from public.historique_statuts_commande h where h.commande_id = c.id
);

create or replace function public.rpc_reclamer_super_admin()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utilisateur uuid := (select auth.uid());
begin
  if v_utilisateur is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  lock table public.administrateurs_plateforme in share row exclusive mode;
  if exists (select 1 from public.administrateurs_plateforme where actif) then
    raise exception 'La plateforme possede deja un administrateur.' using errcode = '42501';
  end if;

  insert into public.administrateurs_plateforme (identite_id, role, actif)
  values (v_utilisateur, 'SUPER_ADMIN', true)
  on conflict (identite_id)
  do update set role = 'SUPER_ADMIN', actif = true;
  return 'SUPER_ADMIN';
end;
$$;

create or replace function public.rpc_inviter_membre(
  p_organisation_id uuid,
  p_email text,
  p_role text default 'MEMBRE'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_invitation uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN'])
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur requis.' using errcode = '42501';
  end if;
  if p_role not in ('ADMIN', 'GESTIONNAIRE', 'AGENT', 'MEMBRE') then
    raise exception 'Role invalide.';
  end if;
  if nullif(trim(p_email), '') is null or position('@' in p_email) < 2 then
    raise exception 'Adresse email invalide.';
  end if;

  update public.invitations_organisation
  set statut = 'ANNULEE'
  where organisation_id = p_organisation_id
    and lower(email::text) = lower(trim(p_email))
    and statut = 'EN_ATTENTE';

  insert into public.invitations_organisation
    (organisation_id, email, role, token, invite_par)
  values
    (p_organisation_id, lower(trim(p_email)), p_role, v_token, (select auth.uid()))
  returning id into v_invitation;

  return jsonb_build_object('id', v_invitation, 'token', v_token);
end;
$$;

create or replace function public.rpc_admin_creer_tenant(
  p_nom text,
  p_slug text,
  p_type text,
  p_email_proprietaire text,
  p_creer_boutique boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_organisation uuid;
  v_boutique uuid;
  v_token uuid := gen_random_uuid();
begin
  if v_admin is null or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if p_type not in ('LOGISTIQUE', 'PRESSING', 'MARCHAND', 'RESTAURANT', 'AUTRE') then
    raise exception 'Type d''organisation invalide.';
  end if;
  if nullif(trim(p_email_proprietaire), '') is null or position('@' in p_email_proprietaire) < 2 then
    raise exception 'Adresse email invalide.';
  end if;

  insert into public.organisations (nom, slug, type, cree_par)
  values (trim(p_nom), lower(trim(p_slug)), p_type, v_admin)
  returning id into v_organisation;

  insert into public.invitations_organisation
    (organisation_id, email, role, token, invite_par)
  values
    (v_organisation, lower(trim(p_email_proprietaire)), 'ADMIN', v_token, v_admin);

  if p_creer_boutique and p_type in ('MARCHAND', 'RESTAURANT') then
    insert into public.boutiques (organisation_id, nom, slug)
    values (v_organisation, trim(p_nom), lower(trim(p_slug)))
    returning id into v_boutique;
  end if;

  return jsonb_build_object(
    'organisation_id', v_organisation,
    'boutique_id', v_boutique,
    'token', v_token
  );
end;
$$;

create or replace function public.rpc_enregistrer_produit_marketplace(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_produit_id uuid default null,
  p_categorie_id uuid default null,
  p_description text default null,
  p_marque text default null,
  p_images text[] default '{}',
  p_statut text default 'ACTIF'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
  v_variante uuid;
  v_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.peut_gerer_boutique(p_boutique_id) then
    raise exception 'Droit gestionnaire requis.' using errcode = '42501';
  end if;
  if nullif(trim(p_nom), '') is null or p_prix < 0 or p_stock < 0 then
    raise exception 'Nom, prix ou stock invalide.';
  end if;
  if p_statut not in ('BROUILLON', 'ACTIF', 'EPUISE', 'ARCHIVE') then
    raise exception 'Statut invalide.';
  end if;

  if p_produit_id is null then
    v_slug := trim(both '-' from lower(regexp_replace(trim(p_nom), '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    insert into public.produits
      (boutique_id, categorie_id, nom, slug, description, marque, prix, images, statut)
    values
      (p_boutique_id, p_categorie_id, trim(p_nom), v_slug,
       nullif(trim(p_description), ''), nullif(trim(p_marque), ''), p_prix,
       coalesce(p_images, '{}'), p_statut)
    returning id into v_produit;

    insert into public.variantes_produit (produit_id, sku, nom)
    values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
    returning id into v_variante;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock);
  else
    select id into v_produit
    from public.produits
    where id = p_produit_id and boutique_id = p_boutique_id
    for update;
    if v_produit is null then
      raise exception 'Produit inaccessible.' using errcode = '42501';
    end if;

    update public.produits
    set categorie_id = p_categorie_id,
        nom = trim(p_nom),
        description = nullif(trim(p_description), ''),
        marque = nullif(trim(p_marque), ''),
        prix = p_prix,
        images = coalesce(p_images, '{}'),
        statut = p_statut
    where id = v_produit;

    select id into v_variante
    from public.variantes_produit
    where produit_id = v_produit
    order by cree_le
    limit 1;
    if v_variante is null then
      insert into public.variantes_produit (produit_id, sku, nom)
      values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
      returning id into v_variante;
    end if;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock)
    on conflict (variante_id)
    do update set quantite = excluded.quantite, modifie_le = now();
  end if;
  return v_produit;
end;
$$;

-- Remplace l'ancienne RPC a deux arguments pour eviter deux contrats PostgREST
-- concurrents et garantir journalisation, motif et restauration du stock.
drop function if exists public.rpc_changer_statut_commande_marketplace(uuid, text);

create or replace function public.rpc_changer_statut_commande_marketplace(
  p_commande_id uuid,
  p_nouveau_statut text,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande public.commandes_marketplace%rowtype;
  v_autorise boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select * into v_commande
  from public.commandes_marketplace
  where id = p_commande_id
  for update;
  if v_commande.id is null or not private.peut_operer_boutique(v_commande.boutique_id) then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;

  v_autorise := case v_commande.statut
    when 'NOUVELLE' then p_nouveau_statut in ('CONFIRMEE', 'ANNULEE')
    when 'CONFIRMEE' then p_nouveau_statut in ('EN_PREPARATION', 'ANNULEE')
    when 'EN_PREPARATION' then p_nouveau_statut in ('PRETE', 'ANNULEE')
    when 'PRETE' then p_nouveau_statut in ('EN_LIVRAISON', 'ANNULEE')
    when 'EN_LIVRAISON' then p_nouveau_statut = 'LIVREE'
    else false
  end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  update public.commandes_marketplace
  set statut = p_nouveau_statut,
      annulee_par = case when p_nouveau_statut = 'ANNULEE' then (select auth.uid()) else annulee_par end,
      motif_annulation = case when p_nouveau_statut = 'ANNULEE' then nullif(trim(p_motif), '') else motif_annulation end,
      vue_le = coalesce(vue_le, now())
  where id = p_commande_id;
end;
$$;

create or replace function public.rpc_annuler_commande_client(
  p_commande_id uuid,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select c.statut into v_statut
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = p_commande_id and a.acheteur_id = (select auth.uid())
  for update of c;
  if v_statut is null then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;
  if v_statut not in ('NOUVELLE', 'CONFIRMEE') then
    raise exception 'Cette commande est deja en preparation.';
  end if;
  update public.commandes_marketplace
  set statut = 'ANNULEE', annulee_par = (select auth.uid()),
      motif_annulation = nullif(trim(p_motif), '')
  where id = p_commande_id;
end;
$$;

revoke all on function public.rpc_reclamer_super_admin() from public, anon;
revoke all on function public.rpc_inviter_membre(uuid, text, text) from public, anon;
revoke all on function public.rpc_admin_creer_tenant(text, text, text, text, boolean) from public, anon;
revoke all on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text, text) from public, anon;
revoke all on function public.rpc_annuler_commande_client(uuid, text) from public, anon;

grant execute on function public.rpc_reclamer_super_admin() to authenticated;
grant execute on function public.rpc_inviter_membre(uuid, text, text) to authenticated;
grant execute on function public.rpc_admin_creer_tenant(text, text, text, text, boolean) to authenticated;
grant execute on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text, text) to authenticated;
grant execute on function public.rpc_annuler_commande_client(uuid, text) to authenticated;

alter table public.configuration_marketplace enable row level security;
alter table public.favoris_marketplace enable row level security;
alter table public.historique_statuts_commande enable row level security;

drop policy if exists configuration_marketplace_lecture on public.configuration_marketplace;
create policy configuration_marketplace_lecture
on public.configuration_marketplace for select to anon, authenticated
using (true);

drop policy if exists configuration_marketplace_admin on public.configuration_marketplace;
create policy configuration_marketplace_admin
on public.configuration_marketplace for update to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN'])));

drop policy if exists favoris_proprietaire on public.favoris_marketplace;
create policy favoris_proprietaire
on public.favoris_marketplace for all to authenticated
using (identite_id = (select auth.uid()))
with check (identite_id = (select auth.uid()));

drop policy if exists historique_acheteur_marchand on public.historique_statuts_commande;
create policy historique_acheteur_marchand
on public.historique_statuts_commande for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = commande_id
    and (a.acheteur_id = (select auth.uid()) or private.peut_operer_boutique(c.boutique_id))
));

drop policy if exists historique_admin on public.historique_statuts_commande;
create policy historique_admin
on public.historique_statuts_commande for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists identites_admin_lecture on public.identites;
create policy identites_admin_lecture on public.identites for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists organisations_admin_lecture on public.organisations;
create policy organisations_admin_lecture on public.organisations for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists boutiques_operateurs_lecture on public.boutiques;
create policy boutiques_operateurs_lecture on public.boutiques for select to authenticated
using ((select private.peut_operer_boutique(id)));

drop policy if exists membres_admin_lecture on public.membres_organisation;
create policy membres_admin_lecture on public.membres_organisation for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists invitations_admin_lecture on public.invitations_organisation;
create policy invitations_admin_lecture on public.invitations_organisation for select to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])));

drop policy if exists administrateurs_lecture_super on public.administrateurs_plateforme;
create policy administrateurs_lecture_super on public.administrateurs_plateforme for select to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN'])));

drop policy if exists adresses_lecture_marchand on public.adresses_livraison;
create policy adresses_lecture_marchand on public.adresses_livraison for select to authenticated
using (
  identite_id = (select auth.uid())
  or exists (
    select 1
    from public.achats a
    join public.commandes_marketplace c on c.achat_id = a.id
    where a.adresse_livraison_id = adresses_livraison.id
      and private.peut_operer_boutique(c.boutique_id)
  )
);

drop policy if exists achats_admin_lecture on public.achats;
create policy achats_admin_lecture on public.achats for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists achats_marchand_lecture on public.achats;
create policy achats_marchand_lecture on public.achats for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  where c.achat_id = achats.id
    and private.peut_operer_boutique(c.boutique_id)
));

drop policy if exists commandes_marchand on public.commandes_marketplace;
create policy commandes_marchand on public.commandes_marketplace for select to authenticated
using ((select private.peut_operer_boutique(boutique_id)));

drop policy if exists commandes_admin_lecture on public.commandes_marketplace;
create policy commandes_admin_lecture on public.commandes_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists lignes_commande_acheteur_marchand on public.lignes_commande_marketplace;
create policy lignes_commande_acheteur_marchand on public.lignes_commande_marketplace for select to authenticated
using (exists (
  select 1
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = commande_id
    and (a.acheteur_id = (select auth.uid()) or private.peut_operer_boutique(c.boutique_id))
));

drop policy if exists lignes_commande_admin_lecture on public.lignes_commande_marketplace;
create policy lignes_commande_admin_lecture on public.lignes_commande_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

drop policy if exists paiements_admin_lecture on public.paiements_marketplace;
create policy paiements_admin_lecture on public.paiements_marketplace for select to authenticated
using ((select private.est_admin_plateforme(null)));

grant select on public.configuration_marketplace to anon;
grant select, update on public.configuration_marketplace to authenticated;
grant select, insert, delete on public.favoris_marketplace to authenticated;
grant select on public.historique_statuts_commande to authenticated;

drop policy if exists marketplace_medias_admin_creation on storage.objects;
create policy marketplace_medias_admin_creation on storage.objects
for insert to authenticated
with check (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

drop policy if exists marketplace_medias_admin_modification on storage.objects;
create policy marketplace_medias_admin_modification on storage.objects
for update to authenticated
using (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])))
with check (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

drop policy if exists marketplace_medias_admin_suppression on storage.objects;
create policy marketplace_medias_admin_suppression on storage.objects
for delete to authenticated
using (bucket_id = 'marketplace' and (select private.est_admin_plateforme(array['SUPER_ADMIN', 'CATALOGUE'])));

insert into public.categories_marketplace (nom, slug, description, image_url, ordre)
values
  ('Mode', 'mode', 'Vetements, chaussures et accessoires', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=82', 10),
  ('Maison', 'maison', 'Decoration, mobilier et quotidien', 'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&w=700&q=82', 20),
  ('Beaute', 'beaute', 'Cosmetiques, soins et bien-etre', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=700&q=82', 30),
  ('Epicerie', 'epicerie', 'Produits frais et alimentation', 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=82', 40),
  ('High-tech', 'high-tech', 'Telephones, informatique et accessoires', 'https://images.unsplash.com/photo-1498049794561-7780e7231661?auto=format&fit=crop&w=700&q=82', 50),
  ('Enfants', 'enfants', 'Jeux, mode et essentiels pour enfants', 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?auto=format&fit=crop&w=700&q=82', 60)
on conflict (slug) do update set
  nom = excluded.nom,
  description = excluded.description,
  image_url = excluded.image_url,
  ordre = excluded.ordre,
  actif = true;

alter table public.commandes_marketplace replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'commandes_marketplace'
  ) then
    alter publication supabase_realtime add table public.commandes_marketplace;
  end if;
end;
$$;
-- <<< FIN SOCLE 20260715000100_marketplace_operations.sql

-- >>> DEBUT SOCLE 20260715000200_marketplace_hardening.sql
-- IKIGAI Market - durcissement apres audit Supabase.

set search_path = public, extensions;

-- Un bucket public sert les URLs sans politique SELECT. Retirer cette politique
-- empeche l'enumeration de tous les fichiers via l'API Storage.
drop policy if exists marketplace_medias_lecture on storage.objects;

-- Fonction d'event trigger interne : elle ne doit jamais etre exposee comme RPC.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Ancienne API remplacee par rpc_enregistrer_produit_marketplace.
drop function if exists public.rpc_creer_produit_marketplace(uuid, text, bigint, integer, text);

create index if not exists avis_produits_identite_idx
  on public.avis_produits(identite_id);

create index if not exists commandes_annulee_par_idx
  on public.commandes_marketplace(annulee_par);

create index if not exists historique_change_par_idx
  on public.historique_statuts_commande(change_par);
-- <<< FIN SOCLE 20260715000200_marketplace_hardening.sql

-- >>> DEBUT SOCLE 20260715000300_marketplace_rls_recursion_fix.sql
-- IKIGAI Market - supprimer les cycles RLS entre achats et commandes.

set search_path = public, extensions;

create or replace function private.est_acheteur_achat(p_achat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.achats a
    where a.id = p_achat_id
      and a.acheteur_id = (select auth.uid())
  );
$$;

create or replace function private.peut_lire_achat_marchand(p_achat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.commandes_marketplace c
    where c.achat_id = p_achat_id
      and private.peut_operer_boutique(c.boutique_id)
  );
$$;

create or replace function private.peut_lire_adresse_marchand(p_adresse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.achats a
    join public.commandes_marketplace c on c.achat_id = a.id
    where a.adresse_livraison_id = p_adresse_id
      and private.peut_operer_boutique(c.boutique_id)
  );
$$;

create or replace function private.peut_lire_commande(p_commande_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.commandes_marketplace c
    join public.achats a on a.id = c.achat_id
    where c.id = p_commande_id
      and (
        a.acheteur_id = (select auth.uid())
        or private.peut_operer_boutique(c.boutique_id)
      )
  );
$$;

create or replace function private.peut_ajouter_avis_produit(p_produit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.lignes_commande_marketplace l
    join public.commandes_marketplace c on c.id = l.commande_id
    join public.achats a on a.id = c.achat_id
    where l.produit_id = p_produit_id
      and a.acheteur_id = (select auth.uid())
      and c.statut = 'LIVREE'
  );
$$;

revoke all on function private.est_acheteur_achat(uuid) from public, anon;
revoke all on function private.peut_lire_achat_marchand(uuid) from public, anon;
revoke all on function private.peut_lire_adresse_marchand(uuid) from public, anon;
revoke all on function private.peut_lire_commande(uuid) from public, anon;
revoke all on function private.peut_ajouter_avis_produit(uuid) from public, anon;

grant execute on function private.est_acheteur_achat(uuid) to authenticated;
grant execute on function private.peut_lire_achat_marchand(uuid) to authenticated;
grant execute on function private.peut_lire_adresse_marchand(uuid) to authenticated;
grant execute on function private.peut_lire_commande(uuid) to authenticated;
grant execute on function private.peut_ajouter_avis_produit(uuid) to authenticated;

drop policy if exists achats_marchand_lecture on public.achats;
create policy achats_marchand_lecture
on public.achats for select to authenticated
using ((select private.peut_lire_achat_marchand(id)));

drop policy if exists commandes_acheteur on public.commandes_marketplace;
create policy commandes_acheteur
on public.commandes_marketplace for select to authenticated
using ((select private.est_acheteur_achat(achat_id)));

drop policy if exists adresses_lecture_marchand on public.adresses_livraison;
create policy adresses_lecture_marchand
on public.adresses_livraison for select to authenticated
using (
  identite_id = (select auth.uid())
  or (select private.peut_lire_adresse_marchand(id))
);

drop policy if exists historique_acheteur_marchand on public.historique_statuts_commande;
create policy historique_acheteur_marchand
on public.historique_statuts_commande for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists lignes_commande_acheteur_marchand on public.lignes_commande_marketplace;
create policy lignes_commande_acheteur_marchand
on public.lignes_commande_marketplace for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists missions_acheteur_marchand on public.missions_logistiques;
create policy missions_acheteur_marchand
on public.missions_logistiques for select to authenticated
using ((select private.peut_lire_commande(commande_id)));

drop policy if exists paiements_acheteur on public.paiements_marketplace;
create policy paiements_acheteur
on public.paiements_marketplace for select to authenticated
using ((select private.est_acheteur_achat(achat_id)));

drop policy if exists avis_creation_acheteur on public.avis_produits;
create policy avis_creation_acheteur
on public.avis_produits for insert to authenticated
with check (
  identite_id = (select auth.uid())
  and (select private.peut_ajouter_avis_produit(produit_id))
);
-- <<< FIN SOCLE 20260715000300_marketplace_rls_recursion_fix.sql

-- >>> DEBUT SOCLE 20260715000400_publish_active_shops.sql
-- IKIGAI Market - publier une boutique quand son catalogue devient actif.

set search_path = public, extensions;

create or replace function private.publier_boutique_produit_actif()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.boutiques
  set statut = 'PUBLIEE', modifie_le = now()
  where id = new.boutique_id
    and statut = 'BROUILLON';
  return new;
end;
$$;

revoke all on function private.publier_boutique_produit_actif()
from public, anon, authenticated;

drop trigger if exists publier_boutique_produit_actif on public.produits;
create trigger publier_boutique_produit_actif
after insert on public.produits
for each row
when (new.statut = 'ACTIF')
execute function private.publier_boutique_produit_actif();

-- Corriger les boutiques deja alimentees avant l'ajout de cette automatisation.
update public.boutiques b
set statut = 'PUBLIEE', modifie_le = now()
where b.statut = 'BROUILLON'
  and exists (
    select 1
    from public.produits p
    where p.boutique_id = b.id
      and p.statut = 'ACTIF'
  );
-- <<< FIN SOCLE 20260715000400_publish_active_shops.sql

-- >>> DEBUT SOCLE 20260715000500_catalog_search_guardrails.sql
-- Recherche catalogue, pagination et garde-fous de publication.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.normaliser_recherche_marketplace(p_texte text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select trim(regexp_replace(extensions.unaccent(lower(coalesce(p_texte, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

revoke all on function public.normaliser_recherche_marketplace(text) from public;
grant execute on function public.normaliser_recherche_marketplace(text) to anon, authenticated;

alter table public.produits
  add column if not exists recherche_texte text
  generated always as (
    public.normaliser_recherche_marketplace(
      coalesce(nom, '') || ' ' || coalesce(marque, '') || ' ' || coalesce(description, '')
    )
  ) stored;

alter table public.produits
  add column if not exists recherche_fts tsvector
  generated always as (
    to_tsvector(
      'simple'::regconfig,
      public.normaliser_recherche_marketplace(
        coalesce(nom, '') || ' ' || coalesce(marque, '') || ' ' || coalesce(description, '')
      )
    )
  ) stored;

alter table public.boutiques
  add column if not exists recherche_texte text
  generated always as (
    public.normaliser_recherche_marketplace(coalesce(nom, '') || ' ' || coalesce(description, ''))
  ) stored;

create index if not exists produits_recherche_fts_idx
  on public.produits using gin (recherche_fts);
create index if not exists produits_recherche_trgm_idx
  on public.produits using gin (recherche_texte extensions.gin_trgm_ops);
create index if not exists boutiques_recherche_trgm_idx
  on public.boutiques using gin (recherche_texte extensions.gin_trgm_ops);
create index if not exists produits_catalogue_idx
  on public.produits (statut, categorie_id, boutique_id, cree_le desc);
create index if not exists stocks_quantite_idx
  on public.stocks (variante_id, quantite);
create index if not exists avis_produits_publics_idx
  on public.avis_produits (produit_id, statut, cree_le desc);

alter table public.produits
  add constraint produits_nom_longueur_check
  check (length(trim(nom)) between 2 and 160) not valid,
  add constraint produits_description_longueur_check
  check (description is null or length(description) <= 5000) not valid,
  add constraint produits_marque_longueur_check
  check (marque is null or length(marque) <= 100) not valid,
  add constraint produits_prix_plafond_check
  check (prix between 1 and 2000000000) not valid,
  add constraint produits_prix_barre_plafond_check
  check (prix_barre is null or prix_barre <= 2000000000) not valid,
  add constraint produits_images_nombre_check
  check (cardinality(images) <= 6) not valid,
  add constraint produits_publication_complete_check
  check (statut in ('BROUILLON', 'ARCHIVE') or (categorie_id is not null and cardinality(images) > 0)) not valid;

alter table public.stocks
  add constraint stocks_quantite_plafond_check
  check (quantite <= 1000000) not valid,
  add constraint stocks_seuil_plafond_check
  check (seuil_alerte <= 1000000) not valid;

alter table public.variantes_produit
  add constraint variantes_nom_longueur_check
  check (length(trim(nom)) between 1 and 120) not valid,
  add constraint variantes_prix_plafond_check
  check (prix is null or prix <= 2000000000) not valid;

alter table public.boutiques
  add constraint boutiques_nom_longueur_check
  check (length(trim(nom)) between 2 and 120) not valid,
  add constraint boutiques_description_longueur_check
  check (description is null or length(description) <= 2000) not valid,
  add constraint boutiques_livraison_plafond_check
  check (frais_livraison_base <= 5000000) not valid,
  add constraint boutiques_preparation_check
  check (delai_preparation_minutes between 0 and 10080) not valid;

alter table public.produits validate constraint produits_nom_longueur_check;
alter table public.produits validate constraint produits_description_longueur_check;
alter table public.produits validate constraint produits_marque_longueur_check;
alter table public.produits validate constraint produits_prix_plafond_check;
alter table public.produits validate constraint produits_prix_barre_plafond_check;
alter table public.produits validate constraint produits_images_nombre_check;
alter table public.produits validate constraint produits_publication_complete_check;
alter table public.stocks validate constraint stocks_quantite_plafond_check;
alter table public.stocks validate constraint stocks_seuil_plafond_check;
alter table public.variantes_produit validate constraint variantes_nom_longueur_check;
alter table public.variantes_produit validate constraint variantes_prix_plafond_check;
alter table public.boutiques validate constraint boutiques_nom_longueur_check;
alter table public.boutiques validate constraint boutiques_description_longueur_check;
alter table public.boutiques validate constraint boutiques_livraison_plafond_check;
alter table public.boutiques validate constraint boutiques_preparation_check;

create or replace function public.rpc_rechercher_produits_marketplace(
  p_recherche text default null,
  p_categorie_id uuid default null,
  p_boutique_id uuid default null,
  p_prix_min bigint default null,
  p_prix_max bigint default null,
  p_note_min numeric default null,
  p_en_stock boolean default false,
  p_tri text default 'PERTINENCE',
  p_page integer default 1,
  p_par_page integer default 24
)
returns table (
  id uuid,
  boutique_id uuid,
  categorie_id uuid,
  nom text,
  slug text,
  description text,
  marque text,
  prix bigint,
  prix_barre bigint,
  images text[],
  statut text,
  cree_le timestamptz,
  boutique_nom text,
  boutique_slug text,
  boutique_logo_url text,
  boutique_frais_livraison bigint,
  categorie_nom text,
  variante_id uuid,
  stock_total bigint,
  note_moyenne numeric,
  avis_count bigint,
  total_resultats bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recherche text := nullif(public.normaliser_recherche_marketplace(p_recherche), '');
  v_requete tsquery;
  v_tri text := upper(coalesce(nullif(trim(p_tri), ''), 'PERTINENCE'));
begin
  if length(coalesce(p_recherche, '')) > 100 then
    raise exception 'La recherche est limitee a 100 caracteres.';
  end if;
  if p_page not between 1 and 1000 then
    raise exception 'Numero de page invalide.';
  end if;
  if p_par_page not between 1 and 48 then
    raise exception 'La page doit contenir entre 1 et 48 produits.';
  end if;
  if p_prix_min is not null and (p_prix_min < 0 or p_prix_min > 2000000000) then
    raise exception 'Prix minimum invalide.';
  end if;
  if p_prix_max is not null and (p_prix_max < 0 or p_prix_max > 2000000000) then
    raise exception 'Prix maximum invalide.';
  end if;
  if p_prix_min is not null and p_prix_max is not null and p_prix_max < p_prix_min then
    raise exception 'Le prix maximum doit etre superieur au prix minimum.';
  end if;
  if p_note_min is not null and (p_note_min < 0 or p_note_min > 5) then
    raise exception 'Note minimale invalide.';
  end if;
  if v_tri not in ('PERTINENCE', 'NOUVEAUTES', 'PRIX_ASC', 'PRIX_DESC', 'NOTE') then
    raise exception 'Tri invalide.';
  end if;

  if v_recherche is not null then
    v_requete := plainto_tsquery('simple'::regconfig, v_recherche);
  end if;

  return query
  with catalogue as (
    select
      p.id,
      p.boutique_id,
      p.categorie_id,
      p.nom,
      p.slug,
      p.description,
      p.marque,
      p.prix,
      p.prix_barre,
      p.images,
      p.statut,
      p.cree_le,
      b.nom as boutique_nom,
      b.slug as boutique_slug,
      b.logo_url as boutique_logo_url,
      b.frais_livraison_base as boutique_frais_livraison,
      c.nom as categorie_nom,
      inventaire.variante_id,
      coalesce(inventaire.stock_total, 0)::bigint as stock_total,
      coalesce(evaluations.note_moyenne, 0)::numeric as note_moyenne,
      coalesce(evaluations.avis_count, 0)::bigint as avis_count,
      case
        when v_recherche is null then 0::real
        else
          (ts_rank(p.recherche_fts, v_requete) * 4)
          + extensions.similarity(p.recherche_texte, v_recherche)
          + extensions.similarity(b.recherche_texte, v_recherche)
          + case when public.normaliser_recherche_marketplace(p.nom) = v_recherche then 3 else 0 end
          + case when p.recherche_texte like v_recherche || '%' then 1 else 0 end
      end as pertinence
    from public.produits p
    join public.boutiques b on b.id = p.boutique_id and b.statut = 'PUBLIEE'
    left join public.categories_marketplace c on c.id = p.categorie_id
    left join lateral (
      select
        (array_agg(v.id order by (coalesce(s.quantite, 0) > 0) desc, v.cree_le))[1] as variante_id,
        coalesce(sum(coalesce(s.quantite, 0)), 0)::bigint as stock_total
      from public.variantes_produit v
      left join public.stocks s on s.variante_id = v.id
      where v.produit_id = p.id and v.actif
    ) inventaire on true
    left join lateral (
      select
        avg(a.note)::numeric(3,2) as note_moyenne,
        count(*)::bigint as avis_count
      from public.avis_produits a
      where a.produit_id = p.id and a.statut = 'PUBLIE'
    ) evaluations on true
    where p.statut in ('ACTIF', 'EPUISE')
      and (p_categorie_id is null or p.categorie_id = p_categorie_id)
      and (p_boutique_id is null or p.boutique_id = p_boutique_id)
      and (
        v_recherche is null
        or p.recherche_fts @@ v_requete
        or p.recherche_texte like '%' || v_recherche || '%'
        or p.recherche_texte operator(extensions.%) v_recherche
        or b.recherche_texte like '%' || v_recherche || '%'
        or b.recherche_texte operator(extensions.%) v_recherche
        or public.normaliser_recherche_marketplace(c.nom) like '%' || v_recherche || '%'
      )
  ), filtres as (
    select *
    from catalogue
    where (p_prix_min is null or catalogue.prix >= p_prix_min)
      and (p_prix_max is null or catalogue.prix <= p_prix_max)
      and (p_note_min is null or catalogue.note_moyenne >= p_note_min)
      and (not coalesce(p_en_stock, false) or catalogue.stock_total > 0)
  )
  select
    f.id,
    f.boutique_id,
    f.categorie_id,
    f.nom,
    f.slug,
    f.description,
    f.marque,
    f.prix,
    f.prix_barre,
    f.images,
    f.statut,
    f.cree_le,
    f.boutique_nom,
    f.boutique_slug,
    f.boutique_logo_url,
    f.boutique_frais_livraison,
    f.categorie_nom,
    f.variante_id,
    f.stock_total,
    f.note_moyenne,
    f.avis_count,
    count(*) over()::bigint as total_resultats
  from filtres f
  order by
    case when v_tri = 'PERTINENCE' and v_recherche is not null then f.pertinence end desc nulls last,
    case when v_tri = 'NOUVEAUTES' or (v_tri = 'PERTINENCE' and v_recherche is null) then f.cree_le end desc nulls last,
    case when v_tri = 'PRIX_ASC' then f.prix end asc nulls last,
    case when v_tri = 'PRIX_DESC' then f.prix end desc nulls last,
    case when v_tri = 'NOTE' then f.note_moyenne end desc nulls last,
    f.cree_le desc,
    f.id
  limit p_par_page
  offset ((p_page - 1) * p_par_page);
end;
$$;

revoke all on function public.rpc_rechercher_produits_marketplace(text, uuid, uuid, bigint, bigint, numeric, boolean, text, integer, integer) from public;
grant execute on function public.rpc_rechercher_produits_marketplace(text, uuid, uuid, bigint, bigint, numeric, boolean, text, integer, integer) to anon, authenticated;

create or replace function public.rpc_enregistrer_produit_marketplace(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_produit_id uuid default null,
  p_categorie_id uuid default null,
  p_description text default null,
  p_marque text default null,
  p_images text[] default '{}',
  p_statut text default 'ACTIF'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
  v_variante uuid;
  v_slug text;
  v_images text[];
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.peut_gerer_boutique(p_boutique_id) then
    raise exception 'Droit gestionnaire requis.' using errcode = '42501';
  end if;
  if nullif(trim(p_nom), '') is null or length(trim(p_nom)) not between 2 and 160 then
    raise exception 'Le nom doit contenir entre 2 et 160 caracteres.';
  end if;
  if p_prix is null or p_prix not between 1 and 2000000000 then
    raise exception 'Le prix doit etre compris entre 1 et 2 000 000 000 FCFA.';
  end if;
  if p_stock is null or p_stock not between 0 and 1000000 then
    raise exception 'Le stock doit etre compris entre 0 et 1 000 000.';
  end if;
  if length(coalesce(p_description, '')) > 5000 then
    raise exception 'La description est limitee a 5 000 caracteres.';
  end if;
  if length(coalesce(p_marque, '')) > 100 then
    raise exception 'La marque est limitee a 100 caracteres.';
  end if;
  if p_statut not in ('BROUILLON', 'ACTIF', 'EPUISE', 'ARCHIVE') then
    raise exception 'Statut invalide.';
  end if;

  select coalesce(array_agg(trim(image_url) order by position), '{}')
  into v_images
  from unnest(coalesce(p_images, '{}')) with ordinality as images(image_url, position)
  where nullif(trim(image_url), '') is not null;

  if cardinality(v_images) > 6 then
    raise exception 'Un produit est limite a 6 images.';
  end if;
  if exists (
    select 1 from unnest(v_images) image_url
    where length(image_url) > 2000 or image_url !~* '^https://'
  ) then
    raise exception 'Chaque image doit utiliser une URL HTTPS valide.';
  end if;
  if p_statut in ('ACTIF', 'EPUISE') and (p_categorie_id is null or cardinality(v_images) = 0) then
    raise exception 'Une categorie et une image sont requises pour publier un produit.';
  end if;
  if p_categorie_id is not null and not exists (
    select 1 from public.categories_marketplace c where c.id = p_categorie_id and c.actif
  ) then
    raise exception 'Categorie invalide ou inactive.';
  end if;

  if p_produit_id is null then
    v_slug := trim(both '-' from lower(regexp_replace(trim(p_nom), '[^a-zA-Z0-9]+', '-', 'g')))
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    insert into public.produits
      (boutique_id, categorie_id, nom, slug, description, marque, prix, images, statut)
    values
      (p_boutique_id, p_categorie_id, trim(p_nom), v_slug,
       nullif(trim(p_description), ''), nullif(trim(p_marque), ''), p_prix,
       v_images, p_statut)
    returning id into v_produit;

    insert into public.variantes_produit (produit_id, sku, nom)
    values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
    returning id into v_variante;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock);
  else
    select id into v_produit
    from public.produits
    where id = p_produit_id and boutique_id = p_boutique_id
    for update;
    if v_produit is null then
      raise exception 'Produit inaccessible.' using errcode = '42501';
    end if;

    update public.produits
    set categorie_id = p_categorie_id,
        nom = trim(p_nom),
        description = nullif(trim(p_description), ''),
        marque = nullif(trim(p_marque), ''),
        prix = p_prix,
        images = v_images,
        statut = p_statut
    where id = v_produit;

    select id into v_variante
    from public.variantes_produit
    where produit_id = v_produit
    order by cree_le
    limit 1;
    if v_variante is null then
      insert into public.variantes_produit (produit_id, sku, nom)
      values (v_produit, 'SKU-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Standard')
      returning id into v_variante;
    end if;
    insert into public.stocks (variante_id, quantite)
    values (v_variante, p_stock)
    on conflict (variante_id)
    do update set quantite = excluded.quantite, modifie_le = now();
  end if;
  return v_produit;
end;
$$;

revoke all on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) from public, anon;
grant execute on function public.rpc_enregistrer_produit_marketplace(uuid, text, bigint, integer, uuid, uuid, text, text, text[], text) to authenticated;
-- <<< FIN SOCLE 20260715000500_catalog_search_guardrails.sql

-- >>> DEBUT SOCLE 20260716000100_order_logistics_workflow.sql
-- IKIGAI Market - workflow de commande, integration IKMS et emails transactionnels.

set search_path = public, extensions;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.configuration_marketplace
  add column if not exists site_public_url text not null
    default 'https://ismaelfofana1998-cloud.github.io/MARKETPLACE-WHITELABEL/',
  add column if not exists ikms_tenant_nom text not null default 'IKIGAI Livraison',
  add column if not exists ikms_tenant_code text not null default 'IKIGAI',
  add column if not exists ikms_api_base_url text,
  add column if not exists ikms_portail_pro_url text,
  add column if not exists zones_livraison jsonb not null default '[]'::jsonb,
  add column if not exists nom_expediteur_email text not null default 'IKIGAI Market',
  add column if not exists email_expediteur text,
  add column if not exists email_api_configuree boolean not null default false,
  add column if not exists emails_transactionnels_actifs boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_zones_array_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_zones_array_check
      check (jsonb_typeof(zones_livraison) = 'array');
  end if;
end $$;

alter table public.adresses_livraison
  add column if not exists code_zone text;

alter table public.integrations_livraison
  add column if not exists zone_depart text,
  add column if not exists expediteur_nom text,
  add column if not exists expediteur_tel text,
  add column if not exists expediteur_adresse text,
  add column if not exists mode_paiement text not null default 'SANS_PAIEMENT',
  add column if not exists cle_api_configuree boolean not null default false,
  add column if not exists derniere_verification timestamptz,
  add column if not exists derniere_erreur text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.integrations_livraison'::regclass
      and conname = 'integrations_livraison_mode_paiement_check'
  ) then
    alter table public.integrations_livraison
      add constraint integrations_livraison_mode_paiement_check
      check (mode_paiement in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR'));
  end if;
end $$;

-- L'ancienne integration utilisait une cle globale partagee. Elle est desactivee
-- jusqu'a ce que le marchand enregistre sa propre cle de client pro IKMS.
update public.integrations_livraison
set actif = false, cle_api_configuree = false
where not cle_api_configuree;

alter table public.missions_logistiques
  add column if not exists statut_ikms text,
  add column if not exists code_ramassage text,
  add column if not exists id_colis text,
  add column if not exists code_livraison text,
  add column if not exists montant_livraison bigint,
  add column if not exists derniere_synchronisation timestamptz,
  add column if not exists reponse_ikms jsonb not null default '{}'::jsonb;

alter table public.missions_logistiques
  drop constraint if exists missions_logistiques_statut_check;
alter table public.missions_logistiques
  add constraint missions_logistiques_statut_check
  check (statut in (
    'A_ENVOYER', 'ENVOI_EN_COURS', 'ENVOYEE', 'ACCEPTEE', 'EN_COURS',
    'LIVREE', 'RETOUR', 'ANNULEE', 'ERREUR'
  ));

alter table public.historique_statuts_commande
  add column if not exists source text not null default 'SYSTEME';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.historique_statuts_commande'::regclass
      and conname = 'historique_statuts_source_check'
  ) then
    alter table public.historique_statuts_commande
      add constraint historique_statuts_source_check
      check (source in ('CLIENT', 'MARCHAND', 'IKMS', 'SYSTEME'));
  end if;
end $$;

create table if not exists public.notifications_email_commande (
  id uuid primary key default gen_random_uuid(),
  historique_id bigint not null unique
    references public.historique_statuts_commande(id) on delete cascade,
  commande_id uuid not null
    references public.commandes_marketplace(id) on delete cascade,
  destinataire_email text not null,
  destinataire_nom text,
  boutique_nom text not null,
  commande_reference text not null,
  statut_commande text not null,
  sujet text not null,
  message text not null,
  statut text not null default 'A_ENVOYER'
    check (statut in ('A_ENVOYER', 'EN_COURS', 'ENVOYEE', 'ERREUR')),
  tentatives integer not null default 0,
  prochaine_tentative timestamptz not null default now(),
  reference_fournisseur text,
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  envoyee_le timestamptz
);

create index if not exists notifications_email_a_envoyer_idx
  on public.notifications_email_commande(prochaine_tentative, cree_le)
  where statut in ('A_ENVOYER', 'ERREUR');
create index if not exists notifications_email_commande_idx
  on public.notifications_email_commande(commande_id, cree_le desc);
create index if not exists missions_externe_idx
  on public.missions_logistiques(commande_livraison_externe_id)
  where commande_livraison_externe_id is not null;
create index if not exists missions_sync_idx
  on public.missions_logistiques(derniere_synchronisation, modifie_le)
  where statut in ('ENVOYEE', 'ACCEPTEE', 'EN_COURS', 'RETOUR');

drop trigger if exists notifications_email_toucher_modification
on public.notifications_email_commande;
create trigger notifications_email_toucher_modification
before update on public.notifications_email_commande
for each row execute function private.toucher_modification();

create or replace function private.journaliser_statut_commande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change_par uuid;
  v_change_par_brut text := nullif(current_setting('ikigai.change_par', true), '');
  v_source text := nullif(current_setting('ikigai.source_statut', true), '');
  v_acheteur uuid;
begin
  v_change_par := coalesce(v_change_par_brut::uuid, (select auth.uid()));

  if v_source is null then
    select a.acheteur_id into v_acheteur
    from public.achats a
    where a.id = new.achat_id;

    v_source := case
      when v_change_par is null then 'SYSTEME'
      when v_change_par = v_acheteur then 'CLIENT'
      else 'MARCHAND'
    end;
  end if;

  if tg_op = 'INSERT' or old.statut is distinct from new.statut then
    insert into public.historique_statuts_commande
      (commande_id, ancien_statut, nouveau_statut, change_par, note, source)
    values
      (new.id, case when tg_op = 'INSERT' then null else old.statut end,
       new.statut, v_change_par, new.motif_annulation, v_source);
  end if;
  return new;
end;
$$;

drop trigger if exists commandes_marketplace_historique
on public.commandes_marketplace;
create trigger commandes_marketplace_historique
after insert or update of statut on public.commandes_marketplace
for each row execute function private.journaliser_statut_commande();

create or replace function private.mettre_notification_commande_en_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications_email_commande (
    historique_id, commande_id, destinataire_email, destinataire_nom,
    boutique_nom, commande_reference, statut_commande, sujet, message
  )
  select
    new.id,
    c.id,
    i.email::text,
    coalesce(nullif(trim(a_liv.destinataire_nom), ''), nullif(trim(concat_ws(' ', i.prenom, i.nom)), ''), 'Client'),
    b.nom,
    c.reference,
    new.nouveau_statut,
    case new.nouveau_statut
      when 'NOUVELLE' then 'Commande ' || c.reference || ' recue'
      when 'CONFIRMEE' then 'Commande ' || c.reference || ' confirmee'
      when 'EN_PREPARATION' then 'Preparation de la commande ' || c.reference
      when 'PRETE' then 'Commande ' || c.reference || ' prete pour la livraison'
      when 'EN_LIVRAISON' then 'Commande ' || c.reference || ' transmise au livreur'
      when 'LIVREE' then 'Commande ' || c.reference || ' livree'
      when 'ANNULEE' then 'Commande ' || c.reference || ' annulee'
      else 'Mise a jour de la commande ' || c.reference
    end,
    case new.nouveau_statut
      when 'NOUVELLE' then 'Votre commande a bien ete recue par la boutique.'
      when 'CONFIRMEE' then 'La boutique a confirme votre commande.'
      when 'EN_PREPARATION' then 'La preparation de votre commande a commence.'
      when 'PRETE' then 'Votre commande est prete et attend sa transmission a IKIGAI Livraison.'
      when 'EN_LIVRAISON' then 'Votre commande a ete transmise a IKIGAI Livraison.'
      when 'LIVREE' then 'IKIGAI Livraison a confirme la livraison de votre commande.'
      when 'ANNULEE' then 'Votre commande a ete annulee.'
      else 'Le statut de votre commande a ete mis a jour.'
    end
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  join public.identites i on i.id = a.acheteur_id
  join public.boutiques b on b.id = c.boutique_id
  left join public.adresses_livraison a_liv on a_liv.id = a.adresse_livraison_id
  where c.id = new.commande_id
    and nullif(trim(i.email::text), '') is not null
  on conflict (historique_id) do nothing;
  return new;
end;
$$;

drop trigger if exists historique_statut_notification_email
on public.historique_statuts_commande;
create trigger historique_statut_notification_email
after insert on public.historique_statuts_commande
for each row execute function private.mettre_notification_commande_en_file();

create or replace function public.rpc_configurer_integration_ikms(
  p_organisation_id uuid,
  p_zone_depart text,
  p_expediteur_nom text,
  p_expediteur_tel text,
  p_expediteur_adresse text,
  p_mode_paiement text default 'SANS_PAIEMENT',
  p_api_key text default null,
  p_actif boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.configuration_marketplace%rowtype;
  v_secret_id uuid;
  v_secret_name text := 'ikms_api_key_' || p_organisation_id::text;
  v_cle_configuree boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN'])
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur marchand requis.' using errcode = '42501';
  end if;

  select * into v_config from public.configuration_marketplace where id = 1;
  if p_mode_paiement not in ('SANS_PAIEMENT', 'A_LA_LIVRAISON', 'PAR_EXPEDITEUR') then
    raise exception 'Mode de paiement IKMS invalide.';
  end if;
  if upper(trim(coalesce(p_zone_depart, ''))) !~ '^[A-Z0-9_-]{2,50}$' then
    raise exception 'Code de zone de ramassage invalide.';
  end if;
  if trim(coalesce(p_expediteur_nom, '')) = ''
     or trim(coalesce(p_expediteur_adresse, '')) = '' then
    raise exception 'Nom et adresse de ramassage requis.';
  end if;
  if trim(coalesce(p_expediteur_tel, '')) !~ '^[0-9]{10}$' then
    raise exception 'Le telephone expediteur doit contenir 10 chiffres.';
  end if;
  if p_actif and nullif(trim(coalesce(v_config.ikms_api_base_url, '')), '') is null then
    raise exception 'Le superadministrateur doit configurer l''URL de l''API IKMS.';
  end if;

  select id into v_secret_id
  from vault.secrets
  where name = v_secret_name;

  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^ik_live_[A-Za-z0-9_-]{16,}$' then
      raise exception 'Cle API IKMS invalide.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_api_key), v_secret_name,
        'Cle API IKMS du client pro marchand ' || p_organisation_id::text, null
      );
    else
      perform vault.update_secret(
        v_secret_id, trim(p_api_key), v_secret_name,
        'Cle API IKMS du client pro marchand ' || p_organisation_id::text, null
      );
    end if;
  end if;

  v_cle_configuree := v_secret_id is not null;
  if p_actif and not v_cle_configuree then
    raise exception 'La cle API du compte client pro IKMS est requise.';
  end if;

  insert into public.integrations_livraison (
    organisation_id, code_entreprise_livraison, compte_pro_externe_id,
    zone_depart, expediteur_nom, expediteur_tel, expediteur_adresse,
    mode_paiement, cle_api_configuree, actif, derniere_erreur
  ) values (
    p_organisation_id, v_config.ikms_tenant_code, null,
    upper(trim(p_zone_depart)), trim(p_expediteur_nom), trim(p_expediteur_tel),
    trim(p_expediteur_adresse), p_mode_paiement, v_cle_configuree, p_actif, null
  )
  on conflict (organisation_id) do update set
    code_entreprise_livraison = excluded.code_entreprise_livraison,
    zone_depart = excluded.zone_depart,
    expediteur_nom = excluded.expediteur_nom,
    expediteur_tel = excluded.expediteur_tel,
    expediteur_adresse = excluded.expediteur_adresse,
    mode_paiement = excluded.mode_paiement,
    cle_api_configuree = excluded.cle_api_configuree,
    actif = excluded.actif,
    derniere_erreur = null,
    modifie_le = now();

  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'actif', p_actif,
    'cle_api_configuree', v_cle_configuree
  );
end;
$$;

create or replace function public.rpc_configurer_email_transactionnel(
  p_email_expediteur text,
  p_nom_expediteur text,
  p_site_public_url text,
  p_api_key text default null,
  p_actif boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret_name text := 'ikigai_market_resend_api_key';
  v_cle_configuree boolean;
begin
  if (select auth.uid()) is null
     or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if trim(coalesce(p_email_expediteur, '')) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Adresse email expediteur invalide.';
  end if;
  if trim(coalesce(p_nom_expediteur, '')) = '' then
    raise exception 'Nom expediteur requis.';
  end if;
  if trim(coalesce(p_site_public_url, '')) !~ '^https://[^[:space:]]+$' then
    raise exception 'URL publique HTTPS requise.';
  end if;

  select id into v_secret_id from vault.secrets where name = v_secret_name;
  if nullif(trim(coalesce(p_api_key, '')), '') is not null then
    if trim(p_api_key) !~ '^re_[A-Za-z0-9_-]{16,}$' then
      raise exception 'Cle API Resend invalide.';
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(
        trim(p_api_key), v_secret_name,
        'Cle Resend pour les emails de statut IKIGAI Market', null
      );
    else
      perform vault.update_secret(
        v_secret_id, trim(p_api_key), v_secret_name,
        'Cle Resend pour les emails de statut IKIGAI Market', null
      );
    end if;
  end if;

  v_cle_configuree := v_secret_id is not null;
  if p_actif and not v_cle_configuree then
    raise exception 'La cle API Resend est requise pour activer les emails.';
  end if;

  update public.configuration_marketplace
  set email_expediteur = lower(trim(p_email_expediteur)),
      nom_expediteur_email = trim(p_nom_expediteur),
      site_public_url = trim(trailing '/' from trim(p_site_public_url)) || '/',
      email_api_configuree = v_cle_configuree,
      emails_transactionnels_actifs = p_actif
  where id = 1;

  return jsonb_build_object(
    'actif', p_actif,
    'cle_api_configuree', v_cle_configuree
  );
end;
$$;

create or replace function public.rpc_lire_integration_ikms(
  p_organisation_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'organisation_id', i.organisation_id,
    'actif', i.actif,
    'api_base_url', c.ikms_api_base_url,
    'tenant_nom', c.ikms_tenant_nom,
    'tenant_code', c.ikms_tenant_code,
    'api_key', s.decrypted_secret,
    'zone_depart', i.zone_depart,
    'expediteur_nom', i.expediteur_nom,
    'expediteur_tel', i.expediteur_tel,
    'expediteur_adresse', i.expediteur_adresse,
    'mode_paiement', i.mode_paiement
  )
  from public.integrations_livraison i
  cross join public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = 'ikms_api_key_' || i.organisation_id::text
  where i.organisation_id = p_organisation_id and c.id = 1;
$$;

create or replace function public.rpc_lire_configuration_email()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'actif', c.emails_transactionnels_actifs,
    'api_key', s.decrypted_secret,
    'email_expediteur', c.email_expediteur,
    'nom_expediteur', c.nom_expediteur_email,
    'site_public_url', c.site_public_url,
    'nom_marketplace', c.nom,
    'couleur_primaire', c.couleur_primaire
  )
  from public.configuration_marketplace c
  left join vault.decrypted_secrets s
    on s.name = 'ikigai_market_resend_api_key'
  where c.id = 1;
$$;

create or replace function public.rpc_verifier_secret_operations(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'ikigai_market_operations_secret'
      and extensions.digest(s.decrypted_secret, 'sha256')
          = extensions.digest(coalesce(p_secret, ''), 'sha256')
  );
$$;

create or replace function public.rpc_reclamer_mission_ikms(
  p_commande_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande record;
  v_mission public.missions_logistiques%rowtype;
begin
  select c.id, c.statut, i.code_entreprise_livraison, i.compte_pro_externe_id
  into v_commande
  from public.commandes_marketplace c
  join public.boutiques b on b.id = c.boutique_id
  join public.integrations_livraison i on i.organisation_id = b.organisation_id
  where c.id = p_commande_id and i.actif and i.cle_api_configuree
  for update of c;

  if v_commande.id is null then
    raise exception 'Commande ou integration IKMS indisponible.';
  end if;

  insert into public.missions_logistiques (
    commande_id, entreprise_livraison_code, compte_pro_externe_id, payload
  ) values (
    p_commande_id, v_commande.code_entreprise_livraison,
    v_commande.compte_pro_externe_id, coalesce(p_payload, '{}'::jsonb)
  ) on conflict (commande_id) do nothing;

  select * into v_mission
  from public.missions_logistiques
  where commande_id = p_commande_id
  for update;

  if v_mission.commande_livraison_externe_id is not null then
    return jsonb_build_object(
      'envoyer', false,
      'mission_id', v_mission.id,
      'commande_livraison_id', v_mission.commande_livraison_externe_id
    );
  end if;
  if v_commande.statut <> 'PRETE' then
    raise exception 'La commande doit etre prete avant transmission.';
  end if;
  if v_mission.statut = 'ENVOI_EN_COURS'
     and v_mission.modifie_le > now() - interval '2 minutes' then
    raise exception 'La transmission IKMS est deja en cours.';
  end if;

  update public.missions_logistiques
  set statut = 'ENVOI_EN_COURS', payload = coalesce(p_payload, '{}'::jsonb),
      tentatives = tentatives + 1, derniere_erreur = null
  where id = v_mission.id;

  return jsonb_build_object('envoyer', true, 'mission_id', v_mission.id);
end;
$$;

create or replace function public.rpc_finaliser_mission_ikms(
  p_mission_id uuid,
  p_acteur_id uuid,
  p_succes boolean,
  p_commande_externe_id text default null,
  p_code_ramassage text default null,
  p_id_colis text default null,
  p_code_livraison text default null,
  p_montant_livraison bigint default null,
  p_reponse jsonb default '{}'::jsonb,
  p_erreur text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande_id uuid;
begin
  select commande_id into v_commande_id
  from public.missions_logistiques
  where id = p_mission_id
  for update;
  if v_commande_id is null then raise exception 'Mission IKMS introuvable.'; end if;

  if not p_succes then
    update public.missions_logistiques
    set statut = 'ERREUR', derniere_erreur = left(coalesce(p_erreur, 'Erreur IKMS'), 2000),
        reponse_ikms = coalesce(p_reponse, '{}'::jsonb), derniere_synchronisation = now()
    where id = p_mission_id;
    return jsonb_build_object('succes', false, 'commande_id', v_commande_id);
  end if;

  if nullif(trim(coalesce(p_commande_externe_id, '')), '') is null then
    raise exception 'Identifiant de commande IKMS manquant.';
  end if;

  update public.missions_logistiques
  set statut = 'ENVOYEE', statut_ikms = 'CREE',
      commande_livraison_externe_id = trim(p_commande_externe_id),
      code_ramassage = p_code_ramassage, id_colis = p_id_colis,
      code_livraison = p_code_livraison, montant_livraison = p_montant_livraison,
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_erreur = null, derniere_synchronisation = now()
  where id = p_mission_id;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
  perform set_config('ikigai.change_par', coalesce(p_acteur_id::text, ''), true);
  update public.commandes_marketplace
  set statut = 'EN_LIVRAISON'
  where id = v_commande_id and statut = 'PRETE';

  return jsonb_build_object(
    'succes', true,
    'commande_id', v_commande_id,
    'commande_livraison_id', trim(p_commande_externe_id)
  );
end;
$$;

create or replace function public.rpc_appliquer_statut_ikms(
  p_mission_id uuid,
  p_statut_ikms text,
  p_reponse jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande_id uuid;
  v_statut_interne text;
  v_livree boolean := false;
begin
  select commande_id into v_commande_id
  from public.missions_logistiques
  where id = p_mission_id
  for update;
  if v_commande_id is null then raise exception 'Mission IKMS introuvable.'; end if;

  v_statut_interne := case
    when p_statut_ikms = 'LIVRE' then 'LIVREE'
    when p_statut_ikms in (
      'RETOUR_EN_COURS', 'RETOUR_DEMANDE', 'RETOUR_RECU',
      'A_RETOURNER', 'RETOUR_ASSIGNE', 'RETOURNE'
    ) then 'RETOUR'
    when p_statut_ikms = 'ANNULE' then 'ANNULEE'
    else 'EN_COURS'
  end;

  update public.missions_logistiques
  set statut = v_statut_interne,
      statut_ikms = upper(trim(coalesce(p_statut_ikms, 'INCONNU'))),
      reponse_ikms = coalesce(p_reponse, '{}'::jsonb),
      derniere_synchronisation = now(),
      derniere_erreur = case
        when p_statut_ikms = 'ANNULE' then 'La mission a ete annulee dans IKMS.'
        else null
      end
  where id = p_mission_id;

  if p_statut_ikms = 'LIVRE' then
    perform set_config('ikigai.source_statut', 'IKMS', true);
    perform set_config('ikigai.change_par', '', true);
    update public.commandes_marketplace
    set statut = 'LIVREE'
    where id = v_commande_id and statut = 'EN_LIVRAISON';
    v_livree := found;
  end if;

  return jsonb_build_object(
    'commande_id', v_commande_id,
    'statut_mission', v_statut_interne,
    'commande_livree', v_livree
  );
end;
$$;

create or replace function public.rpc_reclamer_notifications_email(
  p_commande_id uuid default null,
  p_limite integer default 30
) returns setof public.notifications_email_commande
language sql
security definer
set search_path = ''
as $$
  with candidats as (
    select n.id
    from public.notifications_email_commande n
    where (p_commande_id is null or n.commande_id = p_commande_id)
      and (
        n.statut = 'A_ENVOYER'
        or (n.statut = 'ERREUR' and n.prochaine_tentative <= now())
        or (n.statut = 'EN_COURS' and n.modifie_le < now() - interval '10 minutes')
      )
    order by n.cree_le
    for update skip locked
    limit least(greatest(coalesce(p_limite, 30), 1), 100)
  )
  update public.notifications_email_commande n
  set statut = 'EN_COURS', tentatives = n.tentatives + 1,
      derniere_erreur = null, modifie_le = now()
  from candidats c
  where n.id = c.id
  returning n.*;
$$;

create or replace function public.rpc_changer_statut_commande_marketplace(
  p_commande_id uuid,
  p_nouveau_statut text,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commande public.commandes_marketplace%rowtype;
  v_autorise boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select * into v_commande
  from public.commandes_marketplace
  where id = p_commande_id
  for update;
  if v_commande.id is null or not private.peut_operer_boutique(v_commande.boutique_id) then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;

  v_autorise := case v_commande.statut
    when 'NOUVELLE' then p_nouveau_statut in ('CONFIRMEE', 'ANNULEE')
    when 'CONFIRMEE' then p_nouveau_statut in ('EN_PREPARATION', 'ANNULEE')
    when 'EN_PREPARATION' then p_nouveau_statut in ('PRETE', 'ANNULEE')
    when 'PRETE' then p_nouveau_statut = 'ANNULEE'
    else false
  end;
  if not v_autorise then raise exception 'Transition de statut interdite.'; end if;

  perform set_config('ikigai.source_statut', 'MARCHAND', true);
  update public.commandes_marketplace
  set statut = p_nouveau_statut,
      annulee_par = case when p_nouveau_statut = 'ANNULEE' then (select auth.uid()) else annulee_par end,
      motif_annulation = case when p_nouveau_statut = 'ANNULEE' then nullif(trim(p_motif), '') else motif_annulation end,
      vue_le = coalesce(vue_le, now())
  where id = p_commande_id;
end;
$$;

create or replace function public.rpc_annuler_commande_client(
  p_commande_id uuid,
  p_motif text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statut text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select c.statut into v_statut
  from public.commandes_marketplace c
  join public.achats a on a.id = c.achat_id
  where c.id = p_commande_id and a.acheteur_id = (select auth.uid())
  for update of c;
  if v_statut is null then
    raise exception 'Commande inaccessible.' using errcode = '42501';
  end if;
  if v_statut not in ('NOUVELLE', 'CONFIRMEE') then
    raise exception 'Cette commande est deja en preparation.';
  end if;
  perform set_config('ikigai.source_statut', 'CLIENT', true);
  update public.commandes_marketplace
  set statut = 'ANNULEE', annulee_par = (select auth.uid()),
      motif_annulation = nullif(trim(p_motif), '')
  where id = p_commande_id;
end;
$$;

alter table public.notifications_email_commande enable row level security;

drop policy if exists integrations_gestionnaires on public.integrations_livraison;
drop policy if exists integrations_lecture_administrateurs on public.integrations_livraison;
create policy integrations_lecture_administrateurs
on public.integrations_livraison for select to authenticated
using (
  (select private.est_membre_organisation(
    integrations_livraison.organisation_id,
    array['PROPRIETAIRE', 'ADMIN', 'GESTIONNAIRE', 'AGENT']
  ))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
);

revoke all on public.notifications_email_commande from public, anon, authenticated;
revoke insert, update, delete on public.integrations_livraison from authenticated;
grant select on public.integrations_livraison to authenticated;

revoke all on function private.journaliser_statut_commande() from public, anon, authenticated;
revoke all on function private.mettre_notification_commande_en_file() from public, anon, authenticated;

revoke all on function public.rpc_configurer_integration_ikms(uuid, text, text, text, text, text, text, boolean)
from public, anon;
revoke all on function public.rpc_configurer_email_transactionnel(text, text, text, text, boolean)
from public, anon;
revoke all on function public.rpc_changer_statut_commande_marketplace(uuid, text, text)
from public, anon;
revoke all on function public.rpc_annuler_commande_client(uuid, text)
from public, anon;

grant execute on function public.rpc_configurer_integration_ikms(uuid, text, text, text, text, text, text, boolean)
to authenticated;
grant execute on function public.rpc_configurer_email_transactionnel(text, text, text, text, boolean)
to authenticated;
grant execute on function public.rpc_changer_statut_commande_marketplace(uuid, text, text)
to authenticated;
grant execute on function public.rpc_annuler_commande_client(uuid, text)
to authenticated;

revoke all on function public.rpc_lire_integration_ikms(uuid) from public, anon, authenticated;
revoke all on function public.rpc_lire_configuration_email() from public, anon, authenticated;
revoke all on function public.rpc_verifier_secret_operations(text) from public, anon, authenticated;
revoke all on function public.rpc_reclamer_mission_ikms(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_finaliser_mission_ikms(uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text)
from public, anon, authenticated;
revoke all on function public.rpc_appliquer_statut_ikms(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_reclamer_notifications_email(uuid, integer) from public, anon, authenticated;

grant execute on function public.rpc_lire_integration_ikms(uuid) to service_role;
grant execute on function public.rpc_lire_configuration_email() to service_role;
grant execute on function public.rpc_verifier_secret_operations(text) to service_role;
grant execute on function public.rpc_reclamer_mission_ikms(uuid, jsonb) to service_role;
grant execute on function public.rpc_finaliser_mission_ikms(uuid, uuid, boolean, text, text, text, text, bigint, jsonb, text)
to service_role;
grant execute on function public.rpc_appliquer_statut_ikms(uuid, text, jsonb) to service_role;
grant execute on function public.rpc_reclamer_notifications_email(uuid, integer) to service_role;

do $$
declare
  v_secret_id uuid;
begin
  select id into v_secret_id from vault.secrets
  where name = 'ikigai_market_project_url';
  if v_secret_id is null then
    perform vault.create_secret(
      'https://kcwcxnfxhvjujmticuwv.supabase.co',
      'ikigai_market_project_url',
      'URL du projet IKIGAI Market pour les taches planifiees', null
    );
  else
    perform vault.update_secret(
      v_secret_id, 'https://kcwcxnfxhvjujmticuwv.supabase.co',
      'ikigai_market_project_url',
      'URL du projet IKIGAI Market pour les taches planifiees', null
    );
  end if;

  select id into v_secret_id from vault.secrets
  where name = 'ikigai_market_operations_secret';
  if v_secret_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'ikigai_market_operations_secret',
      'Secret interne des taches IKMS et notifications', null
    );
  end if;
end $$;

do $outer$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'ikigai-market-operations'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'ikigai-market-operations',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'ikigai_market_project_url'
        ) || '/functions/v1/sync-livraisons',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-ikigai-cron-secret', (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'ikigai_market_operations_secret'
          )
        ),
        body := '{"batch":true}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end;
$outer$;
-- <<< FIN SOCLE 20260716000100_order_logistics_workflow.sql

-- >>> DEBUT SOCLE 20260716000200_homepage_carousel.sql
-- IKIGAI Market - galerie administrable du bandeau d'accueil.

set search_path = public, extensions;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'configuration_marketplace'
      and column_name = 'hero_images'
  ) then
    alter table public.configuration_marketplace
      add column hero_images text[] not null default '{}';

    update public.configuration_marketplace
    set hero_images = case
      when nullif(trim(hero_image_url), '') is null then '{}'::text[]
      else array[hero_image_url]
    end;
  end if;
end;
$$;

alter table public.configuration_marketplace
  add column if not exists hero_defilement_secondes smallint not null default 6,
  add column if not exists hero_mode_affichage text not null default 'CONTAIN';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_hero_images_max_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_hero_images_max_check
      check (cardinality(hero_images) <= 6);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_hero_defilement_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_hero_defilement_check
      check (hero_defilement_secondes between 3 and 15);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuration_marketplace'::regclass
      and conname = 'configuration_marketplace_hero_mode_check'
  ) then
    alter table public.configuration_marketplace
      add constraint configuration_marketplace_hero_mode_check
      check (hero_mode_affichage in ('CONTAIN', 'COVER'));
  end if;
end;
$$;

comment on column public.configuration_marketplace.hero_images is
  'Images du carrousel d accueil, dans leur ordre d affichage.';
comment on column public.configuration_marketplace.hero_defilement_secondes is
  'Duree d affichage de chaque image du bandeau.';
comment on column public.configuration_marketplace.hero_mode_affichage is
  'CONTAIN affiche l image entiere, COVER remplit le bandeau.';
-- <<< FIN SOCLE 20260716000200_homepage_carousel.sql


-- White-label multi-etablissements pour IKIGAI Market.
-- Les droits de plateforme restent separes des capacites commerciales.

set search_path = public, extensions;

create table public.offres_organisations (
  organisation_id uuid primary key references public.organisations(id) on delete cascade,
  offre text not null default 'STANDARD' check (offre in ('STANDARD', 'WHITE_LABEL')),
  white_label_actif boolean not null default false,
  domaines_personnalises boolean not null default false,
  max_etablissements integer not null default 1 check (max_etablissements between 1 and 100),
  active boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  check (offre = 'WHITE_LABEL' or (not white_label_actif and not domaines_personnalises and max_etablissements = 1))
);

insert into public.offres_organisations (organisation_id)
select id from public.organisations
on conflict (organisation_id) do nothing;

create or replace function private.initialiser_offre_organisation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.offres_organisations (organisation_id)
  values (new.id)
  on conflict (organisation_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organisations_initialiser_offre on public.organisations;
create trigger organisations_initialiser_offre
after insert on public.organisations
for each row execute function private.initialiser_offre_organisation();

drop trigger if exists offres_organisations_toucher_modification on public.offres_organisations;
create trigger offres_organisations_toucher_modification
before update on public.offres_organisations
for each row execute function private.toucher_modification();

alter table public.boutiques
  drop constraint if exists boutiques_organisation_id_key;

alter table public.boutiques
  add column if not exists code_etablissement text,
  add column if not exists mode_vitrine text not null default 'MARKETPLACE'
    check (mode_vitrine in ('MARKETPLACE', 'WHITE_LABEL'));

update public.boutiques
set code_etablissement = coalesce(nullif(code_etablissement, ''), slug)
where code_etablissement is null or code_etablissement = '';

alter table public.boutiques
  alter column code_etablissement set not null;

create unique index if not exists boutiques_organisation_code_idx
  on public.boutiques(organisation_id, lower(code_etablissement));
create index if not exists boutiques_organisation_statut_idx
  on public.boutiques(organisation_id, statut, cree_le desc);

create or replace function private.valider_capacite_boutique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offre public.offres_organisations%rowtype;
  v_nombre integer;
begin
  select * into v_offre
  from public.offres_organisations
  where organisation_id = new.organisation_id and active;

  if v_offre.organisation_id is null then
    raise exception 'Aucune offre active pour cette organisation.' using errcode = '23514';
  end if;
  if new.mode_vitrine = 'WHITE_LABEL'
     and (v_offre.offre <> 'WHITE_LABEL' or not v_offre.white_label_actif) then
    raise exception 'L''offre Site dedie est requise.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.organisation_id is distinct from old.organisation_id then
    select count(*) into v_nombre
    from public.boutiques
    where organisation_id = new.organisation_id;
    if v_nombre >= v_offre.max_etablissements then
      raise exception 'Le nombre maximal d''etablissements de cette offre est atteint.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists boutiques_valider_capacite on public.boutiques;
create trigger boutiques_valider_capacite
before insert or update of organisation_id, mode_vitrine on public.boutiques
for each row execute function private.valider_capacite_boutique();

create table public.configurations_boutique (
  boutique_id uuid primary key references public.boutiques(id) on delete cascade,
  nom_site text,
  slogan text,
  description text,
  annonce text,
  logo_url text,
  favicon_url text,
  hero_images text[] not null default '{}',
  hero_defilement_secondes integer not null default 6 check (hero_defilement_secondes between 3 and 15),
  hero_mode_affichage text not null default 'COVER' check (hero_mode_affichage in ('CONTAIN', 'COVER')),
  couleur_primaire text not null default '#C75332' check (couleur_primaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_secondaire text not null default '#17211F' check (couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'),
  couleur_accent text not null default '#E9AE36' check (couleur_accent ~ '^#[0-9A-Fa-f]{6}$'),
  email_support text,
  telephone_support text,
  whatsapp text,
  masquer_autres_boutiques boolean not null default true,
  masquer_categories_globales boolean not null default true,
  afficher_signature_plateforme boolean not null default false,
  filtres_actifs jsonb not null default '{"prix":true,"note":true,"stock":true,"tri":true}'::jsonb,
  navigation jsonb not null default '[]'::jsonb,
  pied_de_page jsonb not null default '{}'::jsonb,
  seo_titre text,
  seo_description text,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table public.categories_boutique (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  nom text not null check (length(trim(nom)) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text check (description is null or length(description) <= 1000),
  image_url text,
  ordre integer not null default 0,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  unique (boutique_id, slug)
);

create index if not exists categories_boutique_catalogue_idx
  on public.categories_boutique(boutique_id, actif, ordre, nom);

alter table public.produits
  add column if not exists categorie_boutique_id uuid
    references public.categories_boutique(id) on delete set null;

alter table public.produits
  drop constraint if exists produits_publication_complete_check;
alter table public.produits
  add constraint produits_publication_complete_check
  check (
    statut in ('BROUILLON', 'ARCHIVE')
    or ((categorie_id is not null or categorie_boutique_id is not null) and cardinality(images) > 0)
  );

create index if not exists produits_categorie_boutique_idx
  on public.produits(categorie_boutique_id, statut, cree_le desc);

create table public.domaines_boutique (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  domaine text not null unique check (domaine = lower(domaine) and domaine ~ '^[a-z0-9.-]+$'),
  statut text not null default 'A_VERIFIER' check (statut in ('A_VERIFIER', 'VERIFIE', 'SUSPENDU')),
  principal boolean not null default false,
  jeton_verification uuid not null default gen_random_uuid(),
  verifie_le timestamptz,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create unique index if not exists domaines_boutique_principal_idx
  on public.domaines_boutique(boutique_id)
  where principal and statut = 'VERIFIE';

create or replace function private.est_white_label(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.offres_organisations o
    where o.organisation_id = p_organisation_id
      and o.offre = 'WHITE_LABEL'
      and o.white_label_actif
      and o.active
  );
$$;

create or replace function private.valider_categorie_boutique_produit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.categorie_boutique_id is not null and not exists (
    select 1 from public.categories_boutique c
    where c.id = new.categorie_boutique_id and c.boutique_id = new.boutique_id
  ) then
    raise exception 'La categorie privee appartient a un autre etablissement.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists produits_valider_categorie_boutique on public.produits;
create trigger produits_valider_categorie_boutique
before insert or update of boutique_id, categorie_boutique_id on public.produits
for each row execute function private.valider_categorie_boutique_produit();

drop trigger if exists configurations_boutique_toucher_modification on public.configurations_boutique;
create trigger configurations_boutique_toucher_modification
before update on public.configurations_boutique
for each row execute function private.toucher_modification();

drop trigger if exists categories_boutique_toucher_modification on public.categories_boutique;
create trigger categories_boutique_toucher_modification
before update on public.categories_boutique
for each row execute function private.toucher_modification();

drop trigger if exists domaines_boutique_toucher_modification on public.domaines_boutique;
create trigger domaines_boutique_toucher_modification
before update on public.domaines_boutique
for each row execute function private.toucher_modification();

revoke all on function private.initialiser_offre_organisation() from public, anon, authenticated;
revoke all on function private.est_white_label(uuid) from public, anon, authenticated;
revoke all on function private.valider_categorie_boutique_produit() from public, anon, authenticated;
revoke all on function private.valider_capacite_boutique() from public, anon, authenticated;
grant execute on function private.est_white_label(uuid) to authenticated;

alter table public.offres_organisations enable row level security;
alter table public.configurations_boutique enable row level security;
alter table public.categories_boutique enable row level security;
alter table public.domaines_boutique enable row level security;

create policy offres_lecture_membres
on public.offres_organisations for select to authenticated
using (
  (select private.est_membre_organisation(organisation_id, null))
  or (select private.est_admin_plateforme(null))
);

create policy offres_administration_plateforme
on public.offres_organisations for all to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN'])));

create policy configurations_boutique_publiques
on public.configurations_boutique for select to anon, authenticated
using (exists (
  select 1 from public.boutiques b
  join public.offres_organisations o on o.organisation_id = b.organisation_id
  where b.id = boutique_id and b.statut = 'PUBLIEE'
    and b.mode_vitrine = 'WHITE_LABEL'
    and o.offre = 'WHITE_LABEL' and o.white_label_actif and o.active
));

create policy configurations_boutique_gestionnaires
on public.configurations_boutique for all to authenticated
using (
  (select private.peut_gerer_boutique(boutique_id))
  and exists (select 1 from public.boutiques b where b.id = boutique_id and private.est_white_label(b.organisation_id))
)
with check (
  (select private.peut_gerer_boutique(boutique_id))
  and exists (select 1 from public.boutiques b where b.id = boutique_id and private.est_white_label(b.organisation_id))
);

create policy configurations_boutique_plateforme
on public.configurations_boutique for all to authenticated
using ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])))
with check ((select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT'])));

create policy categories_boutique_publiques
on public.categories_boutique for select to anon, authenticated
using (actif and exists (
  select 1 from public.boutiques b
  join public.offres_organisations o on o.organisation_id = b.organisation_id
  where b.id = boutique_id and b.statut = 'PUBLIEE'
    and b.mode_vitrine = 'WHITE_LABEL'
    and o.offre = 'WHITE_LABEL' and o.white_label_actif and o.active
));

create policy categories_boutique_gestionnaires
on public.categories_boutique for all to authenticated
using (
  (select private.peut_gerer_boutique(boutique_id))
  and exists (
    select 1 from public.boutiques b
    where b.id = boutique_id and private.est_white_label(b.organisation_id)
  )
)
with check (
  (select private.peut_gerer_boutique(boutique_id))
  and exists (
    select 1 from public.boutiques b
    where b.id = boutique_id and private.est_white_label(b.organisation_id)
  )
);

create policy domaines_boutique_gestionnaires
on public.domaines_boutique for all to authenticated
using (
  (select private.peut_gerer_boutique(boutique_id))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
)
with check (
  ((select private.peut_gerer_boutique(boutique_id)) and exists (
    select 1 from public.boutiques b
    join public.offres_organisations o on o.organisation_id = b.organisation_id
    where b.id = boutique_id and o.domaines_personnalises and o.active
  ))
  or (select private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']))
);

grant select on public.offres_organisations to authenticated;
grant select on public.configurations_boutique, public.categories_boutique to anon, authenticated;
grant insert, update, delete on public.configurations_boutique, public.categories_boutique to authenticated;
grant select on public.domaines_boutique to authenticated;

create or replace function public.rpc_ajouter_domaine_boutique(
  p_boutique_id uuid,
  p_domaine text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domaine text := lower(trim(trailing '.' from trim(coalesce(p_domaine, ''))));
  v_resultat public.domaines_boutique%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.peut_gerer_boutique(p_boutique_id) then
    raise exception 'Droit gestionnaire requis.' using errcode = '42501';
  end if;
  if v_domaine !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     or length(v_domaine) > 253 then
    raise exception 'Nom de domaine invalide.';
  end if;
  if not exists (
    select 1
    from public.boutiques b
    join public.offres_organisations o on o.organisation_id = b.organisation_id
    where b.id = p_boutique_id
      and b.mode_vitrine = 'WHITE_LABEL'
      and o.offre = 'WHITE_LABEL'
      and o.white_label_actif
      and o.domaines_personnalises
      and o.active
  ) then
    raise exception 'Les domaines personnalises ne sont pas actifs pour ce Site dedie.' using errcode = '42501';
  end if;

  insert into public.domaines_boutique (boutique_id, domaine)
  values (p_boutique_id, v_domaine)
  returning * into v_resultat;

  return jsonb_build_object(
    'id', v_resultat.id,
    'domaine', v_resultat.domaine,
    'statut', v_resultat.statut,
    'jeton_verification', v_resultat.jeton_verification
  );
end;
$$;

create or replace function public.rpc_supprimer_domaine_boutique(p_domaine_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  select boutique_id into v_boutique_id
  from public.domaines_boutique
  where id = p_domaine_id;
  if v_boutique_id is null or not private.peut_gerer_boutique(v_boutique_id) then
    raise exception 'Domaine inaccessible.' using errcode = '42501';
  end if;
  delete from public.domaines_boutique where id = p_domaine_id;
end;
$$;

create or replace function public.rpc_admin_verifier_domaine_boutique(
  p_domaine_id uuid,
  p_verifie boolean,
  p_principal boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique_id uuid;
begin
  if (select auth.uid()) is null
     or not private.est_admin_plateforme(array['SUPER_ADMIN', 'SUPPORT']) then
    raise exception 'Droit plateforme requis.' using errcode = '42501';
  end if;
  select boutique_id into v_boutique_id
  from public.domaines_boutique
  where id = p_domaine_id
  for update;
  if v_boutique_id is null then raise exception 'Domaine introuvable.'; end if;

  if p_verifie and p_principal then
    update public.domaines_boutique
    set principal = false
    where boutique_id = v_boutique_id and id <> p_domaine_id;
  end if;
  update public.domaines_boutique
  set statut = case when p_verifie then 'VERIFIE' else 'A_VERIFIER' end,
      principal = p_verifie and p_principal,
      verifie_le = case when p_verifie then now() else null end
  where id = p_domaine_id;
end;
$$;

revoke all on function public.rpc_ajouter_domaine_boutique(uuid, text) from public, anon;
revoke all on function public.rpc_supprimer_domaine_boutique(uuid) from public, anon;
revoke all on function public.rpc_admin_verifier_domaine_boutique(uuid, boolean, boolean) from public, anon;
grant execute on function public.rpc_ajouter_domaine_boutique(uuid, text) to authenticated;
grant execute on function public.rpc_supprimer_domaine_boutique(uuid) to authenticated;
grant execute on function public.rpc_admin_verifier_domaine_boutique(uuid, boolean, boolean) to authenticated;

create or replace function public.rpc_admin_definir_offre_organisation(
  p_organisation_id uuid,
  p_offre text,
  p_max_etablissements integer default 1,
  p_domaines_personnalises boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offre text := upper(trim(coalesce(p_offre, '')));
  v_max integer;
begin
  if (select auth.uid()) is null
     or not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit superadministrateur requis.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organisations where id = p_organisation_id) then
    raise exception 'Organisation introuvable.';
  end if;
  if v_offre not in ('STANDARD', 'WHITE_LABEL') then
    raise exception 'Offre invalide.';
  end if;
  v_max := case when v_offre = 'STANDARD' then 1 else greatest(1, least(coalesce(p_max_etablissements, 1), 100)) end;

  insert into public.offres_organisations (
    organisation_id, offre, white_label_actif, domaines_personnalises,
    max_etablissements, active
  ) values (
    p_organisation_id, v_offre, v_offre = 'WHITE_LABEL',
    v_offre = 'WHITE_LABEL' and coalesce(p_domaines_personnalises, false),
    v_max, true
  ) on conflict (organisation_id) do update set
    offre = excluded.offre,
    white_label_actif = excluded.white_label_actif,
    domaines_personnalises = excluded.domaines_personnalises,
    max_etablissements = excluded.max_etablissements,
    active = true,
    modifie_le = now();

  if v_offre = 'WHITE_LABEL' then
    update public.boutiques set mode_vitrine = 'WHITE_LABEL'
    where organisation_id = p_organisation_id;
    insert into public.configurations_boutique (boutique_id, nom_site)
    select id, nom from public.boutiques where organisation_id = p_organisation_id
    on conflict (boutique_id) do nothing;
  else
    update public.boutiques set mode_vitrine = 'MARKETPLACE'
    where organisation_id = p_organisation_id;
  end if;

  return jsonb_build_object(
    'organisation_id', p_organisation_id,
    'offre', v_offre,
    'max_etablissements', v_max,
    'domaines_personnalises', v_offre = 'WHITE_LABEL' and coalesce(p_domaines_personnalises, false)
  );
end;
$$;

create or replace function public.rpc_creer_boutique_marketplace(
  p_organisation_id uuid,
  p_nom text,
  p_slug text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_boutique uuid;
  v_max integer := 1;
  v_offre text := 'STANDARD';
  v_slug text := lower(trim(p_slug));
begin
  if (select auth.uid()) is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;
  if not private.est_membre_organisation(p_organisation_id, array['PROPRIETAIRE', 'ADMIN'])
     and not private.est_admin_plateforme(array['SUPER_ADMIN']) then
    raise exception 'Droit administrateur requis.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organisations
    where id = p_organisation_id and actif and type in ('MARCHAND', 'RESTAURANT')
  ) then
    raise exception 'Cette organisation ne peut pas creer de boutique.';
  end if;
  if nullif(trim(p_nom), '') is null or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Nom ou adresse web invalide.';
  end if;

  select o.offre, o.max_etablissements into v_offre, v_max
  from public.offres_organisations o where o.organisation_id = p_organisation_id and o.active;
  v_offre := coalesce(v_offre, 'STANDARD');
  v_max := coalesce(v_max, 1);

  if (select count(*) from public.boutiques where organisation_id = p_organisation_id) >= v_max then
    raise exception 'Le nombre maximal d''etablissements de cette offre est atteint.';
  end if;

  insert into public.boutiques (
    organisation_id, nom, slug, code_etablissement, mode_vitrine
  ) values (
    p_organisation_id, trim(p_nom), v_slug, v_slug,
    case when v_offre = 'WHITE_LABEL' then 'WHITE_LABEL' else 'MARKETPLACE' end
  ) returning id into v_boutique;

  if v_offre = 'WHITE_LABEL' then
    insert into public.configurations_boutique (boutique_id, nom_site)
    values (v_boutique, trim(p_nom));
  end if;
  return v_boutique;
end;
$$;

create or replace function public.rpc_resoudre_vitrine(
  p_slug text default null,
  p_hote text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_boutique public.boutiques%rowtype;
  v_configuration public.configurations_boutique%rowtype;
  v_offre public.offres_organisations%rowtype;
  v_hote text := lower(split_part(trim(coalesce(p_hote, '')), ':', 1));
begin
  select b.* into v_boutique
  from public.boutiques b
  join public.offres_organisations o on o.organisation_id = b.organisation_id
  left join public.domaines_boutique d
    on d.boutique_id = b.id and d.statut = 'VERIFIE'
  where b.statut = 'PUBLIEE'
    and b.mode_vitrine = 'WHITE_LABEL'
    and o.offre = 'WHITE_LABEL' and o.white_label_actif and o.active
    and (
      (nullif(trim(coalesce(p_slug, '')), '') is not null and b.slug = lower(trim(p_slug)))
      or
      (nullif(trim(coalesce(p_slug, '')), '') is null and v_hote <> '' and d.domaine = v_hote)
    )
  order by d.principal desc nulls last, b.cree_le
  limit 1;

  if v_boutique.id is null then return null; end if;
  select * into v_configuration from public.configurations_boutique where boutique_id = v_boutique.id;
  select * into v_offre from public.offres_organisations where organisation_id = v_boutique.organisation_id;

  return jsonb_build_object(
    'boutique', jsonb_build_object(
      'id', v_boutique.id, 'organisation_id', v_boutique.organisation_id,
      'nom', v_boutique.nom, 'slug', v_boutique.slug,
      'description', v_boutique.description, 'logo_url', v_boutique.logo_url,
      'banniere_url', v_boutique.banniere_url, 'telephone', v_boutique.telephone,
      'whatsapp', v_boutique.whatsapp, 'adresse', v_boutique.adresse,
      'frais_livraison_base', v_boutique.frais_livraison_base
    ),
    'configuration', coalesce(to_jsonb(v_configuration), jsonb_build_object(
      'boutique_id', v_boutique.id, 'nom_site', v_boutique.nom,
      'description', v_boutique.description, 'logo_url', v_boutique.logo_url,
      'hero_images', array_remove(array[v_boutique.banniere_url], null)
    )),
    'offre', jsonb_build_object(
      'code', v_offre.offre,
      'domaines_personnalises', v_offre.domaines_personnalises,
      'max_etablissements', v_offre.max_etablissements
    )
  );
end;
$$;

create or replace function public.rpc_rechercher_produits_vitrine(
  p_boutique_id uuid,
  p_recherche text default null,
  p_categorie_id uuid default null,
  p_prix_min bigint default null,
  p_prix_max bigint default null,
  p_note_min numeric default null,
  p_en_stock boolean default false,
  p_tri text default 'PERTINENCE',
  p_page integer default 1,
  p_par_page integer default 24
) returns table (
  id uuid, boutique_id uuid, categorie_id uuid, nom text, slug text,
  description text, marque text, prix bigint, prix_barre bigint, images text[],
  statut text, cree_le timestamptz, boutique_nom text, boutique_slug text,
  boutique_logo_url text, boutique_frais_livraison bigint, categorie_nom text,
  variante_id uuid, stock_total bigint, note_moyenne numeric,
  avis_count bigint, total_resultats bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_recherche text := nullif(public.normaliser_recherche_marketplace(p_recherche), '');
  v_tri text := upper(coalesce(nullif(trim(p_tri), ''), 'PERTINENCE'));
begin
  if p_page not between 1 and 1000 or p_par_page not between 1 and 48 then
    raise exception 'Pagination invalide.';
  end if;
  if length(coalesce(p_recherche, '')) > 100 then raise exception 'Recherche trop longue.'; end if;
  if p_prix_min is not null and p_prix_min < 0 then raise exception 'Prix minimum invalide.'; end if;
  if p_prix_max is not null and p_prix_max < coalesce(p_prix_min, 0) then raise exception 'Prix maximum invalide.'; end if;
  if p_note_min is not null and p_note_min not between 0 and 5 then raise exception 'Note invalide.'; end if;
  if v_tri not in ('PERTINENCE', 'NOUVEAUTES', 'PRIX_ASC', 'PRIX_DESC', 'NOTE') then raise exception 'Tri invalide.'; end if;

  return query
  with catalogue as (
    select p.id, p.boutique_id,
      coalesce(p.categorie_boutique_id, p.categorie_id) as categorie_id,
      p.nom, p.slug, p.description, p.marque, p.prix, p.prix_barre,
      p.images, p.statut, p.cree_le, b.nom as boutique_nom,
      b.slug as boutique_slug, b.logo_url as boutique_logo_url,
      b.frais_livraison_base as boutique_frais_livraison,
      coalesce(cb.nom, cm.nom) as categorie_nom,
      inv.variante_id, coalesce(inv.stock_total, 0)::bigint as stock_total,
      coalesce(av.note_moyenne, 0)::numeric as note_moyenne,
      coalesce(av.avis_count, 0)::bigint as avis_count,
      case when v_recherche is null then 0::real else
        extensions.similarity(p.recherche_texte, v_recherche)
        + case when p.recherche_texte like '%' || v_recherche || '%' then 2 else 0 end
      end as pertinence
    from public.produits p
    join public.boutiques b on b.id = p.boutique_id and b.statut = 'PUBLIEE' and b.mode_vitrine = 'WHITE_LABEL'
    join public.offres_organisations o on o.organisation_id = b.organisation_id
      and o.offre = 'WHITE_LABEL' and o.white_label_actif and o.active
    left join public.categories_boutique cb on cb.id = p.categorie_boutique_id and cb.actif
    left join public.categories_marketplace cm on cm.id = p.categorie_id
    left join lateral (
      select (array_agg(v.id order by (coalesce(s.quantite, 0) > 0) desc, v.cree_le))[1] as variante_id,
        coalesce(sum(coalesce(s.quantite, 0)), 0)::bigint as stock_total
      from public.variantes_produit v left join public.stocks s on s.variante_id = v.id
      where v.produit_id = p.id and v.actif
    ) inv on true
    left join lateral (
      select avg(a.note)::numeric(3,2) as note_moyenne, count(*)::bigint as avis_count
      from public.avis_produits a where a.produit_id = p.id and a.statut = 'PUBLIE'
    ) av on true
    where p.boutique_id = p_boutique_id and p.statut in ('ACTIF', 'EPUISE')
      and (p_categorie_id is null or coalesce(p.categorie_boutique_id, p.categorie_id) = p_categorie_id)
      and (v_recherche is null or p.recherche_texte like '%' || v_recherche || '%'
        or public.normaliser_recherche_marketplace(coalesce(cb.nom, cm.nom, '')) like '%' || v_recherche || '%')
  ), filtres as (
    select * from catalogue c
    where (p_prix_min is null or c.prix >= p_prix_min)
      and (p_prix_max is null or c.prix <= p_prix_max)
      and (p_note_min is null or c.note_moyenne >= p_note_min)
      and (not coalesce(p_en_stock, false) or c.stock_total > 0)
  )
  select f.id, f.boutique_id, f.categorie_id, f.nom, f.slug, f.description,
    f.marque, f.prix, f.prix_barre, f.images, f.statut, f.cree_le,
    f.boutique_nom, f.boutique_slug, f.boutique_logo_url,
    f.boutique_frais_livraison, f.categorie_nom, f.variante_id,
    f.stock_total, f.note_moyenne, f.avis_count, count(*) over()::bigint
  from filtres f
  order by
    case when v_tri = 'PERTINENCE' and v_recherche is not null then f.pertinence end desc nulls last,
    case when v_tri = 'NOUVEAUTES' or (v_tri = 'PERTINENCE' and v_recherche is null) then f.cree_le end desc nulls last,
    case when v_tri = 'PRIX_ASC' then f.prix end asc nulls last,
    case when v_tri = 'PRIX_DESC' then f.prix end desc nulls last,
    case when v_tri = 'NOTE' then f.note_moyenne end desc nulls last,
    f.cree_le desc, f.id
  limit p_par_page offset ((p_page - 1) * p_par_page);
end;
$$;

create or replace function public.rpc_enregistrer_produit_vitrine(
  p_boutique_id uuid,
  p_nom text,
  p_prix bigint,
  p_stock integer,
  p_produit_id uuid default null,
  p_categorie_id uuid default null,
  p_categorie_boutique_id uuid default null,
  p_description text default null,
  p_marque text default null,
  p_images text[] default '{}',
  p_statut text default 'ACTIF'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentification requise.' using errcode = '28000'; end if;
  if not private.peut_gerer_boutique(p_boutique_id) then
    raise exception 'Droit gestionnaire requis.' using errcode = '42501';
  end if;
  if p_categorie_id is not null and p_categorie_boutique_id is not null then
    raise exception 'Choisis une seule categorie.';
  end if;
  if p_categorie_boutique_id is not null and not exists (
    select 1 from public.categories_boutique c
    where c.id = p_categorie_boutique_id and c.boutique_id = p_boutique_id and c.actif
  ) then
    raise exception 'Categorie du Site dedie invalide ou inactive.';
  end if;
  if p_statut in ('ACTIF', 'EPUISE')
     and p_categorie_id is null and p_categorie_boutique_id is null then
    raise exception 'Une categorie est requise pour publier un produit.';
  end if;

  v_produit := public.rpc_enregistrer_produit_marketplace(
    p_boutique_id, p_nom, p_prix, p_stock, p_produit_id,
    p_categorie_id, p_description, p_marque, p_images,
    case when p_categorie_boutique_id is not null then 'BROUILLON' else p_statut end
  );

  update public.produits
  set categorie_boutique_id = p_categorie_boutique_id,
      categorie_id = case when p_categorie_boutique_id is not null then null else p_categorie_id end,
      statut = p_statut
  where id = v_produit and boutique_id = p_boutique_id;
  return v_produit;
end;
$$;

revoke all on function public.rpc_admin_definir_offre_organisation(uuid, text, integer, boolean) from public, anon;
revoke all on function public.rpc_creer_boutique_marketplace(uuid, text, text) from public, anon;
revoke all on function public.rpc_resoudre_vitrine(text, text) from public;
revoke all on function public.rpc_rechercher_produits_vitrine(uuid, text, uuid, bigint, bigint, numeric, boolean, text, integer, integer) from public;
revoke all on function public.rpc_enregistrer_produit_vitrine(uuid, text, bigint, integer, uuid, uuid, uuid, text, text, text[], text) from public, anon;
grant execute on function public.rpc_admin_definir_offre_organisation(uuid, text, integer, boolean) to authenticated;
grant execute on function public.rpc_creer_boutique_marketplace(uuid, text, text) to authenticated;
grant execute on function public.rpc_resoudre_vitrine(text, text) to anon, authenticated;
grant execute on function public.rpc_rechercher_produits_vitrine(uuid, text, uuid, bigint, bigint, numeric, boolean, text, integer, integer) to anon, authenticated;
grant execute on function public.rpc_enregistrer_produit_vitrine(uuid, text, bigint, integer, uuid, uuid, uuid, text, text, text[], text) to authenticated;
