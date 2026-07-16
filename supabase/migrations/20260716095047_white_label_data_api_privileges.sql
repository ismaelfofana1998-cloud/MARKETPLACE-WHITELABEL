-- Les nouveaux projets Supabase accordent des privileges Data API par defaut.
-- RLS reste active, mais les operations qui la contournent (TRUNCATE, TRIGGER,
-- REFERENCES) et les ecritures sensibles sont retirees explicitement.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

revoke all on table public.offres_organisations from anon, authenticated;
grant select on table public.offres_organisations to authenticated;

revoke all on table public.configurations_boutique from anon, authenticated;
grant select on table public.configurations_boutique to anon, authenticated;
grant insert, update, delete on table public.configurations_boutique to authenticated;

revoke all on table public.categories_boutique from anon, authenticated;
grant select on table public.categories_boutique to anon, authenticated;
grant insert, update, delete on table public.categories_boutique to authenticated;

revoke all on table public.domaines_boutique from anon, authenticated;
grant select on table public.domaines_boutique to authenticated;

revoke all on table public.integrations_ikms_boutique from anon, authenticated;
grant select on table public.integrations_ikms_boutique to authenticated;

revoke all on table public.paniers, public.lignes_panier, public.achats
  from anon, authenticated;
grant select on table public.paniers, public.lignes_panier, public.achats
  to authenticated;
