-- Test SQL de la colocation (20261019000001_flats.sql) contre un PostgreSQL ordinaire (sans Supabase) :
-- un schéma `auth` minimal remplace celui de Supabase. À lancer sur une base VIDE :
--   createdb flats_test && psql -v ON_ERROR_STOP=1 -d flats_test -f tests/flats.sql
-- Chaque vérification lève une exception si elle échoue ; « TOUT EST OK » s'affiche à la fin.
\set ON_ERROR_STOP on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
-- Équivalent minimal de _require_active() des migrations précédentes.
create function public._require_active() returns uuid language plpgsql stable security definer set search_path = '' as $$
begin if auth.uid() is null then raise exception 'non authentifié' using errcode = '28000'; end if; return auth.uid(); end $$;
\i supabase/migrations/20261019000001_flats.sql
\i supabase/migrations/20261020000001_flat_chores.sql
\i supabase/migrations/20261021000001_flat_chores_full.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@t'), ('00000000-0000-0000-0000-00000000000b', 'b@t'),
  ('00000000-0000-0000-0000-00000000000c', 'c@t'), ('00000000-0000-0000-0000-00000000000d', 'd@t');

create function pg_temp.as_user(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create function pg_temp.fails(q text, expect text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like '%' || expect || '%' then return; end if;
    raise exception 'mauvaise erreur pour [%] : % (attendu : %)', q, sqlerrm, expect;
  end;
  raise exception 'aurait dû échouer : %', q;
end $$;
create function pg_temp.eq(a anyelement, b anyelement, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'ÉCHEC % : % <> %', msg, a, b; end if; end $$;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- Sans appartement
select pg_temp.eq(public.my_flat() is null, true, 'my_flat null sans appartement');
select pg_temp.fails($$select public.add_flat_grocery('Lait', 'Frais', '', 100)$$, 'pas d''appartement');
select pg_temp.fails($$select public.create_flat('   ', 'Alice')$$, 'invalide');
-- Création
create temp table ctx as select public.create_flat('Coloc des Lilas', 'Alice') as flat; grant all on ctx to public;
select pg_temp.eq((select count(*) from public.flats), 1::bigint, 'A voit son appartement');
select pg_temp.fails($$select public.create_flat('Autre', 'Alice')$$, 'déjà un appartement');
create temp table code as select (public.my_flat() ->> 'invite_code') as c; grant all on code to public;
select pg_temp.eq(length((select c from code)), 10, 'code de 10 caractères');

-- Un inconnu ne voit rien et ne peut rien écrire
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.eq((select count(*) from public.flats), 0::bigint, 'D ne voit aucun appartement');
select pg_temp.eq((select count(*) from public.flat_members), 0::bigint, 'D ne voit aucun membre');
select pg_temp.fails($$insert into public.flat_groceries (flat_id, name, added_by) select flat, 'x', '00000000-0000-0000-0000-00000000000d' from ctx$$, 'permission denied');
select pg_temp.fails($$update public.flats set name = 'piraté'$$, 'permission denied');
select pg_temp.eq(public.join_flat('ZZZZZZZZZZ', 'Dan') is null, true, 'code inconnu : null');

-- B rejoint avec le code (minuscules et espaces tolérés)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.join_flat('  ' || lower((select c from code)) || ' ', 'Bob');
select pg_temp.eq(jsonb_array_length(public.my_flat() -> 'members'), 2, 'deux membres');
select pg_temp.fails($$select public.join_flat((select c from code), 'Bob')$$, 'déjà un appartement');
select pg_temp.fails($$select public.regenerate_invite_code()$$, 'réservé au propriétaire');
select pg_temp.fails($$select public.remove_flat_member('00000000-0000-0000-0000-00000000000a')$$, 'réservé au propriétaire');

-- Courses communes : A et B voient et modifient la même liste
select public.add_flat_grocery('Lait', 'Frais', 'x2', 120);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.add_flat_grocery('Pâtes', 'Épicerie', '', 0);
select pg_temp.eq((select count(*) from public.flat_groceries), 2::bigint, 'liste commune : 2 articles vus par A');
select public.set_flat_grocery((select id from public.flat_groceries where name = 'Lait'), true, null);
select public.set_flat_grocery((select id from public.flat_groceries where name = 'Pâtes'), true, 89);
select pg_temp.eq((select price_cents from public.flat_groceries where name = 'Lait'), 120, 'prix conservé quand null');
select pg_temp.fails($$select public.add_flat_grocery('', 'x', '', 0)$$, 'invalide');
select pg_temp.fails($$select public.add_flat_grocery('X', 'x', '', -5)$$, 'check');

-- Dépenses : contrôles de cohérence
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": 400, "00000000-0000-0000-0000-00000000000b": 400}')$$, 'somme des parts');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000c', '{"00000000-0000-0000-0000-00000000000a": 1000}')$$, 'payeur');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000c": 1000}')$$, 'participant');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": -500, "00000000-0000-0000-0000-00000000000b": 1500}')$$, 'part invalide');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": 10.5, "00000000-0000-0000-0000-00000000000b": 989.5}')$$, 'part invalide');
select pg_temp.fails($$select public.add_flat_expense(0, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{}')$$, 'montant');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date + 30, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": 1000}')$$, 'date');
select pg_temp.fails($$select public.add_flat_expense(1000, 'x', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": 1000}', 'hack')$$, 'type');

-- Validation des achats communs : crée la dépense, vide les articles cochés
select public.flat_checkout(1234, 'Courses', current_date, '00000000-0000-0000-0000-00000000000a',
  '{"00000000-0000-0000-0000-00000000000a": 617, "00000000-0000-0000-0000-00000000000b": 617}');
select pg_temp.eq((select count(*) from public.flat_groceries), 0::bigint, 'articles cochés retirés');
select pg_temp.eq((select jsonb_array_length(items) from public.flat_expenses), 2, 'noms des articles gardés avec la dépense');
select pg_temp.fails($$select public.flat_checkout(500, 'Courses', current_date, '00000000-0000-0000-0000-00000000000a', '{"00000000-0000-0000-0000-00000000000a": 500}')$$, 'aucun article coché');
-- B voit la dépense, ne peut pas la modifier directement ; seul l'auteur ou le propriétaire la supprime
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.eq((select count(*) from public.flat_expenses), 1::bigint, 'B voit la dépense');
select pg_temp.fails($$update public.flat_expenses set amount_cents = 1$$, 'permission denied');
select public.remove_flat_expense((select id from public.flat_expenses));
select pg_temp.eq((select count(*) from public.flat_expenses), 1::bigint, 'B ne supprime pas la dépense de A');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.add_flat_expense(900, 'Internet', current_date, '00000000-0000-0000-0000-00000000000b', '{"00000000-0000-0000-0000-00000000000a": 450, "00000000-0000-0000-0000-00000000000b": 450}');
select public.remove_flat_expense((select id from public.flat_expenses where label = 'Internet'));  -- propriétaire (et auteur)
select pg_temp.eq((select count(*) from public.flat_expenses where label = 'Internet'), 0::bigint, 'dépense supprimée');

-- Code d'invitation : régénération (ancien code invalide)
select public.regenerate_invite_code();
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.eq(public.join_flat((select c from code), 'Cleo') is null, true, 'ancien code invalide après régénération');
-- Limite d'essais : 15 par heure
do $$ begin for i in 1..14 loop perform public.join_flat('AAAAAAAAAA', 'Cleo'); end loop; end $$;
select pg_temp.fails($$select public.join_flat('AAAAAAAAAA', 'Cleo')$$, 'trop d''essais');

-- Départ : le propriétaire part, le plus ancien membre hérite ; l'historique garde les noms
reset role; update public.flat_join_log set at = now() - interval '2 hours'; set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.leave_flat();
select pg_temp.eq(public.my_flat() is null, true, 'A n''a plus d''appartement');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.eq(public.my_flat() -> 'members' -> 0 ->> 'display_name', 'Alice', 'nom de l''ancien membre gardé');
select pg_temp.eq((select count(*) from public.flat_members where role = 'owner' and left_at is null), 1::bigint, 'B est devenu propriétaire');
select pg_temp.eq((select role from public.flat_members where user_id = '00000000-0000-0000-0000-00000000000b'), 'owner', 'B propriétaire');
-- B retire un membre, puis quitte : l'appartement disparaît quand le dernier part
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.leave_flat();
reset role;
select pg_temp.eq((select count(*) from public.flats), 0::bigint, 'dernier membre parti : appartement supprimé');
select pg_temp.eq((select count(*) from public.flat_expenses), 0::bigint, 'historique supprimé avec l''appartement');

-- Plafond de 8 membres
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select public.create_flat('Grande coloc', 'Alice');
create temp table code2 as select (public.my_flat() ->> 'invite_code') as c; grant all on code2 to public;
reset role;
insert into auth.users (id, email) select ('10000000-0000-0000-0000-00000000000' || g)::uuid, g || '@t' from generate_series(1, 9) g;
set role authenticated;
do $$ declare i int; begin for i in 1..7 loop perform set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-00000000000' || i, false); perform public.join_flat((select c from code2), 'M' || i); end loop; end $$;
select pg_temp.as_user('10000000-0000-0000-0000-000000000008');
select pg_temp.fails($$select public.join_flat((select c from code2), 'M8')$$, 'complet');
reset role;

-- ================================================================ Ménage partagé (20261020000001_flat_chores.sql)
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'f1@t'), ('00000000-0000-0000-0000-0000000000f2', 'f2@t');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
set role authenticated;
select public.create_flat('Coloc ménage', 'Alice');
create temp table code3 as select (public.my_flat() ->> 'invite_code') as c; grant all on code3 to public;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.join_flat((select c from code3), 'Bob');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.add_flat_chore('Poubelles', 'weekly', 2, null, 10, '["00000000-0000-0000-0000-0000000000f1","00000000-0000-0000-0000-0000000000f2"]');
select public.add_flat_chore('Cuisine', 'daily', 0, null, 15, '[]');
select public.add_flat_chore('Grand ménage', 'once', 0, current_date + 3, 60, '["00000000-0000-0000-0000-0000000000f2"]');
select pg_temp.fails($$select public.add_flat_chore('x', 'monthly', 0, null, 10, '[]')$$, 'récurrence');
select pg_temp.fails($$select public.add_flat_chore('x', 'once', 0, null, 10, '[]')$$, 'date invalide');
select pg_temp.fails($$select public.add_flat_chore('', 'daily', 0, null, 10, '[]')$$, 'invalide');
select pg_temp.fails($$select public.add_flat_chore('x', 'daily', 0, null, 10, '["00000000-0000-0000-0000-00000000000d"]')$$, 'pas membre');
select pg_temp.fails($$select public.add_flat_chore('x', 'daily', 9, null, 10, '[]')$$, 'check');
-- Bob voit les corvées d'Alice, coche, Alice voit « fait par Bob »
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.eq((select count(*) from public.flat_chores), 3::bigint, 'Bob voit les 3 corvées');
select public.set_flat_chore_done((select id from public.flat_chores where name = 'Cuisine'), current_date, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select pg_temp.eq((select done_by from public.flat_chore_done limit 1), '00000000-0000-0000-0000-0000000000f2'::uuid, 'fait par Bob visible par Alice');
-- Alice (propriétaire) peut décocher ; un second coche le même jour ne remplace pas l'auteur
select public.set_flat_chore_done((select id from public.flat_chores where name = 'Cuisine'), current_date, true);
select pg_temp.eq((select done_by from public.flat_chore_done limit 1), '00000000-0000-0000-0000-0000000000f2'::uuid, 'auteur conservé');
select public.set_flat_chore_done((select id from public.flat_chores where name = 'Cuisine'), current_date, false);
select pg_temp.eq((select count(*) from public.flat_chore_done), 0::bigint, 'propriétaire décoche');
select pg_temp.fails($$select public.set_flat_chore_done((select id from public.flat_chores where name = 'Cuisine'), current_date + 10, true)$$, 'date invalide');
-- Un membre ne peut pas décocher ce qu'un autre a coché, ni supprimer une corvée qu'il n'a pas créée
select public.set_flat_chore_done((select id from public.flat_chores where name = 'Poubelles'), current_date, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.set_flat_chore_done((select id from public.flat_chores where name = 'Poubelles'), current_date, false);
select pg_temp.eq((select count(*) from public.flat_chore_done), 1::bigint, 'Bob ne décoche pas le coche d''Alice');
select public.remove_flat_chore((select id from public.flat_chores where name = 'Poubelles'));
select pg_temp.eq((select count(*) from public.flat_chores where name = 'Poubelles'), 1::bigint, 'Bob ne supprime pas la corvée d''Alice');
-- Un inconnu ne voit rien
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e@t');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.eq((select count(*) from public.flat_chores), 0::bigint, 'étranger : aucune corvée');
select pg_temp.eq((select count(*) from public.flat_chore_done), 0::bigint, 'étranger : aucun coche');
select pg_temp.fails($$insert into public.flat_chores (flat_id, name, recurrence, created_by) select id, 'x', 'daily', '00000000-0000-0000-0000-0000000000e1' from public.flats$$, 'permission denied');
-- Suppression par l'auteur
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.remove_flat_chore((select id from public.flat_chores where name = 'Poubelles'));
select pg_temp.eq((select count(*) from public.flat_chores where name = 'Poubelles'), 0::bigint, 'auteur supprime sa corvée');
select pg_temp.eq((select count(*) from public.flat_chore_done), 0::bigint, 'coches supprimés avec la corvée');
reset role;

-- ================================================================ Ménage complet (20261021000001_flat_chores_full.sql)
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table cx as select public.save_flat_chore(null, 'Frigo', 'weekly', 6, null, 20, '18:30', '[{"id":"s1","text":"Vider"},{"id":"s2","text":"Laver"}]', '["00000000-0000-0000-0000-0000000000f1","00000000-0000-0000-0000-0000000000f2"]') as id; grant all on cx to public;
select pg_temp.eq((select time from public.flat_chores where id = (select id from cx)), '18:30', 'heure enregistrée');
select pg_temp.eq(jsonb_array_length((select steps from public.flat_chores where id = (select id from cx))), 2, 'étapes enregistrées');
select pg_temp.fails($$select public.save_flat_chore(null, 'x', 'daily', 0, null, 10, '25:99', '[]', '[]')$$, 'heure invalide');
select pg_temp.fails($$select public.save_flat_chore(null, 'x', 'daily', 0, null, 10, null, '[{"id":"a","text":""}]', '[]')$$, 'étape invalide');
select pg_temp.fails($$select public.save_flat_chore(null, 'x', 'daily', 0, null, 10, null, '"nope"', '[]')$$, 'étapes invalides');
-- modification par un autre membre (étapes), pas par un étranger
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.save_flat_chore((select id from cx), 'Frigo', 'weekly', 6, null, 20, '18:30', '[{"id":"s1","text":"Vider"}]', '["00000000-0000-0000-0000-0000000000f1"]');
select pg_temp.eq(jsonb_array_length((select steps from public.flat_chores where id = (select id from cx))), 1, 'un membre modifie les étapes');
-- état d'un jour : étapes, fait, report
select public.set_flat_chore_day((select id from cx), current_date, null, null, '["s1"]');
select pg_temp.eq((select steps_done from public.flat_chore_done where chore_id = (select id from cx)), '["s1"]'::jsonb, 'étapes cochées enregistrées (ligne sans « fait »)');
select pg_temp.eq((select done_by from public.flat_chore_done where chore_id = (select id from cx)) is null, true, 'ligne d''étapes : pas « fait »');
select public.set_flat_chore_day((select id from cx), current_date, true);
select pg_temp.eq((select done_by from public.flat_chore_done where chore_id = (select id from cx)), '00000000-0000-0000-0000-0000000000f2'::uuid, 'fait par F2');
select pg_temp.eq((select ticked_on from public.flat_chore_done where chore_id = (select id from cx)), current_date, 'jour réel du coche enregistré');
select pg_temp.eq((select steps_done from public.flat_chore_done where chore_id = (select id from cx)), '["s1"]'::jsonb, 'étapes conservées en cochant');
-- F1 (propriétaire) décoche ; F2 ne décoche pas le coche d'un autre
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.set_flat_chore_day((select id from cx), current_date + 1, true);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select public.set_flat_chore_day((select id from cx), current_date + 1, false);
select pg_temp.eq((select done_by from public.flat_chore_done where chore_id = (select id from cx) and done_on = current_date + 1), '00000000-0000-0000-0000-0000000000f1'::uuid, 'F2 ne décoche pas le coche de F1');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.set_flat_chore_day((select id from cx), current_date + 1, false);
select pg_temp.eq((select count(*) from public.flat_chore_done where chore_id = (select id from cx) and done_on = current_date + 1), 0::bigint, 'ligne vide supprimée');
-- report : annule le « fait » de soi, puis se retire
select public.set_flat_chore_day((select id from cx), current_date + 2, true);
select public.set_flat_chore_day((select id from cx), current_date + 2, null, true);
select pg_temp.eq((select skipped from public.flat_chore_done where chore_id = (select id from cx) and done_on = current_date + 2), true, 'reportée');
select pg_temp.eq((select done_by from public.flat_chore_done where chore_id = (select id from cx) and done_on = current_date + 2) is null, true, 'reportée : plus « fait »');
select public.set_flat_chore_day((select id from cx), current_date + 2, null, false);
select pg_temp.eq((select count(*) from public.flat_chore_done where chore_id = (select id from cx) and done_on = current_date + 2), 0::bigint, 'report annulé');
select pg_temp.fails($$select public.set_flat_chore_day((select id from cx), current_date + 200, true)$$, 'date invalide');
select pg_temp.fails($$select public.set_flat_chore_day((select id from cx), current_date, null, null, '[1,2]')$$, 'étapes invalides');
-- étranger : rien
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.fails($$select public.save_flat_chore((select id from cx), 'x', 'daily', 0, null, 10, null, '[]', '[]')$$, 'pas d''appartement');
reset role;
select 'TOUT EST OK' as resultat;
