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
