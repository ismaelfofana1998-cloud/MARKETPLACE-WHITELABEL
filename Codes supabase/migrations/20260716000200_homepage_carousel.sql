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
