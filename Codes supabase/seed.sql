insert into public.categories_marketplace (nom, slug, image_url, ordre)
values
  ('Mode', 'mode', 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=600&q=80', 10),
  ('Maison', 'maison', 'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&w=600&q=80', 20),
  ('Beauté', 'beaute', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=600&q=80', 30),
  ('Épicerie', 'epicerie', 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80', 40)
on conflict (slug) do update set image_url = excluded.image_url, ordre = excluded.ordre, actif = true;
