-- Conversion des anciens libelles manuels vers les codes du catalogue IKMS.
-- Les valeurs inconnues sont conservees pour ne pas alterer une zone reelle
-- sans correspondance explicite ; l'interface demandera alors un nouveau choix.
update public.identites
set zone_livraison = case upper(trim(zone_livraison))
  when 'COCODY' then 'COC'
  when 'MARCORY' then 'MAR'
  when 'YOPOUGON' then 'YOP'
  else upper(trim(zone_livraison))
end
where zone_livraison is not null;

update public.adresses_livraison
set code_zone = case upper(trim(code_zone))
  when 'COCODY' then 'COC'
  when 'MARCORY' then 'MAR'
  when 'YOPOUGON' then 'YOP'
  else upper(trim(code_zone))
end
where code_zone is not null;
