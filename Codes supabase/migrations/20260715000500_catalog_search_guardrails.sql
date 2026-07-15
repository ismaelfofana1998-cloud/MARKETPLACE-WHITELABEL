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
