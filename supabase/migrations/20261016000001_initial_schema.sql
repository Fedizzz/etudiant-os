-- Étudiant.OS — schéma initial
-- Modèle : l'application est pilotée par un état unique (AppState) et un reducer partagé (src/core.ts).
-- Chaque utilisateur possède donc UN document JSONB versionné (public.user_data) plutôt qu'une table par module :
--   * la logique métier reste dans core.ts (aucun calcul dupliqué en SQL) ;
--   * la synchronisation se fait par version (verrouillage optimiste) + rejeu des actions en attente côté client ;
--   * le profil (nom d'affichage) est séparé pour rester lisible et modifiable sans réécrire le document.
-- Les fichiers (PDF d'emploi du temps) vont dans le bucket privé « user-files », un dossier par utilisateur.

-- ---------------------------------------------------------------- Profils
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Données de l'application
create table public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or char_length(updated_by) <= 64),
  -- Validation minimale côté serveur ; la validation détaillée est faite par validateState (core.ts).
  -- coalesce : un champ absent donne NULL, qu'un CHECK considérerait comme valide.
  constraint state_is_app_state check (coalesce(
    jsonb_typeof(state) = 'object'
    and state ->> 'version' = '1'
    and jsonb_typeof(state -> 'tasks') = 'array'
    and jsonb_typeof(state -> 'courses') = 'array'
    and jsonb_typeof(state -> 'settings') = 'object'
    and jsonb_typeof(state -> 'budget') = 'object', false)),
  constraint state_size check (pg_column_size(state) < 5 * 1024 * 1024)
);

-- updated_at automatique
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- Profil créé automatiquement à l'inscription (nom repris des métadonnées d'inscription).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- Sécurité : RLS + privilèges
alter table public.profiles enable row level security;
alter table public.user_data enable row level security;

revoke all on public.profiles, public.user_data from anon, authenticated, public;
grant select, update on public.profiles to authenticated;
grant select, delete on public.user_data to authenticated;  -- écriture uniquement via save_state()

create policy "profil : lecture du sien" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profil : modification du sien" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "données : lecture des siennes" on public.user_data for select to authenticated using ((select auth.uid()) = user_id);
create policy "données : suppression des siennes" on public.user_data for delete to authenticated using ((select auth.uid()) = user_id);
-- Pas de politique INSERT/UPDATE : toute écriture passe par save_state(), qui contrôle la version.

-- ---------------------------------------------------------------- Écriture versionnée
-- Enregistre l'état si p_base_version correspond à la version en base (0 = premier enregistrement).
-- Sinon renvoie conflict = true avec l'état serveur : le client rejoue alors ses actions en attente dessus.
create function public.save_state(p_state jsonb, p_base_version integer, p_client text default null)
returns table (ok boolean, version integer, state jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  cur public.user_data%rowtype;
begin
  if uid is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  select * into cur from public.user_data d where d.user_id = uid for update;
  if not found then
    if p_base_version <> 0 then
      return query select false, 0, null::jsonb, null::timestamptz; return;
    end if;
    insert into public.user_data as d (user_id, state, version, updated_by) values (uid, p_state, 1, p_client)
      returning true, d.version, null::jsonb, d.updated_at into ok, version, state, updated_at;
    return next; return;
  end if;
  if cur.version <> p_base_version then
    return query select false, cur.version, cur.state, cur.updated_at; return;
  end if;
  update public.user_data d set state = p_state, version = cur.version + 1, updated_at = now(), updated_by = p_client
    where d.user_id = uid returning true, d.version, null::jsonb, d.updated_at into ok, version, state, updated_at;
  return next;
end $$;
-- SECURITY DEFINER : les clients n'ont aucun droit INSERT/UPDATE direct ; la fonction n'écrit que la ligne de auth.uid().
revoke all on function public.save_state(jsonb, integer, text) from public, anon;
grant execute on function public.save_state(jsonb, integer, text) to authenticated;

-- ---------------------------------------------------------------- Suppression du compte
-- Supprime le compte de l'appelant (et, par cascade, son profil et ses données).
-- Les fichiers du bucket doivent être supprimés par le client AVANT (l'API Storage l'impose).
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'user-files' and (storage.foldername(o.name))[1] = uid::text) then
    raise exception 'fichiers restants : supprimez-les d''abord' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Les fonctions utilitaires ne sont pas appelables par l'API.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- Temps réel (synchronisation entre appareils)
alter publication supabase_realtime add table public.user_data;

-- ---------------------------------------------------------------- Stockage des fichiers
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-files', 'user-files', false, 10485760, array['application/pdf']);

create policy "fichiers : lecture des siens" on storage.objects for select to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fichiers : ajout dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fichiers : remplacement des siens" on storage.objects for update to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fichiers : suppression des siens" on storage.objects for delete to authenticated
  using (bucket_id = 'user-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
