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
