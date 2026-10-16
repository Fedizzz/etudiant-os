-- Données de la stack LOCALE uniquement (supabase start / db reset). Jamais appliqué en production :
-- `supabase db push` n'exécute pas ce fichier.
-- Adresses d'administration de TEST (domaine .local, n'existe pas) pour les tests automatisés.
insert into public.admin_allowlist (email) values ('admin-test-1@test.local'), ('admin-test-2@test.local') on conflict do nothing;
insert into public.admin_allowlist (email) values ('admin-test-3@test.local') on conflict do nothing;
