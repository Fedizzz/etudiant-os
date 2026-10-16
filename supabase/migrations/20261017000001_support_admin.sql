-- Étudiant.OS — administration, signalements, centre d'aide, messagerie, notifications, journal d'audit.
--
-- Principes de sécurité :
--   * Le rôle administrateur n'est JAMAIS décidé par le client. Il est accordé par la base quand un compte
--     dont l'adresse figure dans admin_allowlist a CONFIRMÉ cette adresse (auth.users.email_confirmed_at).
--     is_admin() revérifie tout à chaque appel (rôle + liste + confirmation + compte non suspendu).
--   * admin_allowlist et user_roles ne sont modifiables par AUCUN rôle de l'API (anon / authenticated) :
--     seulement par une migration ou l'éditeur SQL (rôle postgres). Aucune fonction n'accorde de rôle.
--   * Toutes les écritures passent par des fonctions SECURITY DEFINER qui vérifient l'identité (auth.uid())
--     et les droits ; les tables n'ont aucun droit INSERT/UPDATE/DELETE pour les clients.
--   * Les opérations administratives sont journalisées dans admin_audit, qui ne peut être ni modifié ni vidé.

-- ================================================================ Rôles
create table public.admin_allowlist (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
insert into public.admin_allowlist (email) values ('fedizayen12@gmail.com'), ('khaled05062006@gmail.com');

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role = 'admin'),
  granted_at timestamptz not null default now(),
  granted_via text not null
);

-- Vrai si l'appelant est administrateur : rôle présent ET adresse toujours dans la liste ET confirmée ET non suspendu.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r
    join auth.users u on u.id = r.user_id
    where r.user_id = auth.uid() and r.role = 'admin'
      and u.email_confirmed_at is not null
      and lower(u.email) in (select a.email from public.admin_allowlist a)
      and (u.banned_until is null or u.banned_until < now())
  );
$$;

-- ================================================================ Profils : statut du compte
alter table public.profiles
  add column status text not null default 'active' check (status in ('active', 'suspended')),
  add column status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  add column status_changed_at timestamptz,
  add column deletion_requested_at timestamptz;  -- procédure de suppression lancée par un administrateur

-- Le client ne peut plus modifier que son nom d'affichage (pas son statut).
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create function public.account_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.status = 'active' from public.profiles p where p.id = auth.uid()), false);
$$;

-- ================================================================ Journal d'audit (append-only)
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,                 -- pas de clé étrangère : la trace survit à la suppression des comptes
  actor_email text,
  action text not null,
  target_user uuid,
  target_email text,
  target_ticket uuid,
  summary jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index admin_audit_created on public.admin_audit (created_at desc);
create index admin_audit_target on public.admin_audit (target_user);

create function public.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'le journal d''audit ne peut pas être modifié ni effacé' using errcode = '42501';
end $$;
create trigger admin_audit_no_update before update or delete on public.admin_audit for each row execute function public.audit_immutable();
create trigger admin_audit_no_truncate before truncate on public.admin_audit for each statement execute function public.audit_immutable();

create function public._audit(p_action text, p_target_user uuid, p_target_ticket uuid, p_summary jsonb, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  insert into public.admin_audit (actor_id, actor_email, action, target_user, target_email, target_ticket, summary, reason)
  values (actor, (select u.email from auth.users u where u.id = actor), p_action, p_target_user,
          (select u.email from auth.users u where u.id = p_target_user), p_target_ticket, coalesce(p_summary, '{}'::jsonb), p_reason);
end $$;

-- ================================================================ Attribution automatique du rôle (côté base uniquement)
create function public.sync_admin_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and lower(new.email) in (select a.email from public.admin_allowlist a) then
    insert into public.user_roles (user_id, role, granted_via) values (new.id, 'admin', 'allowlist+email_confirmed')
      on conflict (user_id) do nothing;
    if found then
      insert into public.admin_audit (actor_id, actor_email, action, target_user, target_email, summary)
      values (null, 'système', 'role_granted', new.id, new.email, jsonb_build_object('role', 'admin', 'via', 'adresse autorisée confirmée'));
    end if;
  else
    delete from public.user_roles where user_id = new.id;
    if found then
      insert into public.admin_audit (actor_id, actor_email, action, target_user, target_email, summary)
      values (null, 'système', 'role_revoked', new.id, new.email, jsonb_build_object('role', 'admin'));
    end if;
  end if;
  return new;
end $$;
create trigger on_auth_user_admin after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.sync_admin_role();

-- Recalcule les rôles (après modification manuelle de admin_allowlist). Réservé au rôle postgres.
create function public.sync_admin_roles() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_roles (user_id, role, granted_via)
    select u.id, 'admin', 'allowlist+email_confirmed' from auth.users u
    where u.email_confirmed_at is not null and lower(u.email) in (select a.email from public.admin_allowlist a)
    on conflict (user_id) do nothing;
  delete from public.user_roles r using auth.users u
    where u.id = r.user_id and (u.email_confirmed_at is null or lower(u.email) not in (select a.email from public.admin_allowlist a));
end $$;
select public.sync_admin_roles();  -- comptes déjà existants

-- ================================================================ Tickets, messages, notes, notifications
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bug', 'help')),
  category text not null check (category in (
    'display', 'calculation', 'planning', 'sync', 'login', 'data', 'performance', 'other',            -- bug
    'feature_question', 'usage', 'account', 'connection', 'data_sync', 'correction', 'suggestion', 'other_request')),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 5000),
  module text check (module in ('dashboard', 'academic', 'planning', 'focus', 'groceries', 'budget', 'chores', 'sleep', 'settings', 'account', 'other')),
  steps text check (char_length(steps) <= 3000),
  expected text check (char_length(expected) <= 1000),
  observed text check (char_length(observed) <= 1000),
  frequency text check (frequency in ('once', 'sometimes', 'often', 'always')),
  impact text check (impact in ('low', 'medium', 'high', 'blocking')),
  urgency text check (urgency in ('low', 'normal', 'high')),
  tech jsonb check (tech is null or (jsonb_typeof(tech) = 'object' and pg_column_size(tech) < 4096)),
  attachment_path text,
  status text not null default 'new' check (status in ('new', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  assigned_to uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_by text not null default 'user' check (last_message_by in ('user', 'admin')),
  owner_read_at timestamptz not null default now(),
  admin_read_at timestamptz,
  resolved_at timestamptz,
  constraint bug_fields check (kind = 'help' or (frequency is not null and impact is not null))
);
create index tickets_owner on public.tickets (owner_id, last_message_at desc);
create index tickets_status on public.tickets (status, priority);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_role text not null check (author_role in ('user', 'admin', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  attachment_path text,
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket on public.ticket_messages (ticket_id, created_at);

-- Notes internes : jamais visibles par l'utilisateur (table séparée, lecture réservée aux administrateurs).
create table public.ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create table public.user_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticket_id uuid references public.tickets (id) on delete cascade,
  kind text not null check (kind in ('admin_reply', 'user_message', 'ticket_resolved', 'ticket_reopened', 'info_requested', 'new_ticket')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, read_at, created_at desc);

-- ================================================================ RLS + privilèges
alter table public.admin_allowlist enable row level security;
alter table public.user_roles enable row level security;
alter table public.admin_audit enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_notes enable row level security;
alter table public.user_notes enable row level security;
alter table public.notifications enable row level security;

revoke all on public.admin_allowlist, public.user_roles, public.admin_audit, public.tickets, public.ticket_messages,
  public.ticket_notes, public.user_notes, public.notifications from anon, authenticated, public;
-- Lecture seule pour les clients ; AUCUN droit d'écriture direct (tout passe par les fonctions ci-dessous).
grant select on public.user_roles, public.admin_audit, public.tickets, public.ticket_messages,
  public.ticket_notes, public.user_notes, public.notifications to authenticated;
-- admin_allowlist : aucun droit (ni lecture ni écriture) pour l'API.

create policy "rôles : le sien ou admin" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "audit : administrateurs" on public.admin_audit for select to authenticated using ((select public.is_admin()));
create policy "tickets : les siens ou admin" on public.tickets for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy "messages : de ses tickets ou admin" on public.ticket_messages for select to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.tickets t where t.id = ticket_id and t.owner_id = (select auth.uid())));
create policy "notes ticket : administrateurs" on public.ticket_notes for select to authenticated using ((select public.is_admin()));
create policy "notes utilisateur : administrateurs" on public.user_notes for select to authenticated using ((select public.is_admin()));
create policy "notifications : les siennes" on public.notifications for select to authenticated using (user_id = (select auth.uid()));

-- Un compte suspendu ne lit plus ses données synchronisées.
drop policy "données : lecture des siennes" on public.user_data;
create policy "données : lecture des siennes" on public.user_data for select to authenticated
  using ((select auth.uid()) = user_id and (select public.account_active()));

alter publication supabase_realtime add table public.notifications;

-- ================================================================ Fonctions communes
create function public._require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  if not public.is_admin() then raise exception 'accès réservé aux administrateurs' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function public._require_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  if not public.account_active() then raise exception 'compte suspendu' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function public._notify_admins(p_ticket uuid, p_kind text, p_except uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, ticket_id, kind)
  select r.user_id, p_ticket, p_kind from public.user_roles r join auth.users u on u.id = r.user_id
  where r.role = 'admin' and r.user_id is distinct from p_except
    and u.email_confirmed_at is not null and lower(u.email) in (select a.email from public.admin_allowlist a);
$$;

-- Une pièce jointe doit appartenir à l'appelant (son dossier) et exister : impossible de référencer le fichier d'un autre.
create function public._check_attachment(p_path text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_path is null or p_path = '' then return null; end if;
  if p_path !~ '^[0-9a-f-]{36}/[0-9a-z-]{1,64}\.(png|jpg|jpeg|webp)$' or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'pièce jointe invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'support-files' and o.name = p_path) then
    raise exception 'pièce jointe introuvable' using errcode = '22023';
  end if;
  return p_path;
end $$;

-- ================================================================ Utilisateur : rôle, tickets, messages
create function public.my_role() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('is_admin', public.is_admin(), 'active', public.account_active());
$$;

create function public.create_ticket(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_active();
  k text := p ->> 'kind';
  t public.tickets%rowtype;
  prio text;
begin
  if (select count(*) from public.tickets x where x.owner_id = uid and x.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'trop de demandes : réessayez dans une heure' using errcode = 'P0001';
  end if;
  if k not in ('bug', 'help') then raise exception 'type de demande invalide' using errcode = '22023'; end if;
  prio := case when k = 'bug' then case p ->> 'impact' when 'blocking' then 'high' when 'high' then 'high' when 'low' then 'low' else 'normal' end
               else case p ->> 'urgency' when 'high' then 'high' when 'low' then 'low' else 'normal' end end;
  insert into public.tickets (owner_id, kind, category, subject, description, module, steps, expected, observed,
                              frequency, impact, urgency, tech, attachment_path, priority)
  values (uid, k, p ->> 'category', btrim(p ->> 'subject'), btrim(p ->> 'description'), nullif(p ->> 'module', ''),
          nullif(btrim(coalesce(p ->> 'steps', '')), ''), nullif(btrim(coalesce(p ->> 'expected', '')), ''), nullif(btrim(coalesce(p ->> 'observed', '')), ''),
          case when k = 'bug' then p ->> 'frequency' end, case when k = 'bug' then p ->> 'impact' end,
          case when k = 'help' then coalesce(nullif(p ->> 'urgency', ''), 'normal') end,
          case when jsonb_typeof(p -> 'tech') = 'object' then p -> 'tech' end,
          public._check_attachment(p ->> 'attachment_path'), prio)
  returning * into t;
  perform public._notify_admins(t.id, 'new_ticket', uid);
  return jsonb_build_object('id', t.id, 'number', t.number);
end $$;

-- Message dans une conversation. Le rôle de l'auteur est déterminé par la base, jamais par le client.
create function public.post_message(p_ticket uuid, p_body text, p_attachment text default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_active();
  t public.tickets%rowtype;
  role text;
  m public.ticket_messages%rowtype;
begin
  select * into t from public.tickets x where x.id = p_ticket for update;
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  if t.owner_id = uid then role := 'user';
  elsif public.is_admin() then role := 'admin';
  else raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  if role = 'user' and t.status = 'closed' then raise exception 'ticket fermé : ouvrez une nouvelle demande' using errcode = 'P0001'; end if;
  if p_status is not null and role <> 'admin' then raise exception 'changement de statut non autorisé' using errcode = '42501'; end if;

  insert into public.ticket_messages (ticket_id, author_id, author_role, body, attachment_path)
  values (t.id, uid, role, btrim(p_body), public._check_attachment(p_attachment)) returning * into m;

  if role = 'user' then
    update public.tickets set last_message_at = m.created_at, last_message_by = 'user', owner_read_at = m.created_at, updated_at = now(),
      status = case when status in ('waiting_user', 'resolved') then 'open' else status end,
      resolved_at = case when status = 'resolved' then null else resolved_at end
    where id = t.id;
    if t.status = 'resolved' then
      insert into public.ticket_messages (ticket_id, author_role, body) values (t.id, 'system', 'Ticket rouvert par l''utilisateur.');
      perform public._notify_admins(t.id, 'ticket_reopened', uid);
    else
      perform public._notify_admins(t.id, 'user_message', uid);
    end if;
  else
    update public.tickets set last_message_at = m.created_at, last_message_by = 'admin', admin_read_at = m.created_at, updated_at = now(),
      status = coalesce(p_status, case when status = 'new' then 'open' else status end)
    where id = t.id;
    insert into public.notifications (user_id, ticket_id, kind)
    values (t.owner_id, t.id, case when p_status = 'waiting_user' then 'info_requested' else 'admin_reply' end);
    perform public._audit('reply_sent', t.owner_id, t.id, jsonb_build_object('message_id', m.id, 'length', char_length(m.body), 'attachment', m.attachment_path is not null), null);
    if p_status is not null and p_status <> t.status then
      perform public._apply_status(t, p_status, null);
    end if;
  end if;
  return jsonb_build_object('id', m.id, 'created_at', m.created_at, 'author_role', m.author_role);
end $$;

-- Changement de statut (administrateur) : message système visible + notification + journal.
create function public._apply_status(t public.tickets, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare labels jsonb := '{"new":"Nouveau","open":"Ouvert","in_progress":"En cours","waiting_user":"En attente de ta réponse","resolved":"Résolu","closed":"Fermé"}';
begin
  if p_status not in ('new', 'open', 'in_progress', 'waiting_user', 'resolved', 'closed') then raise exception 'statut invalide' using errcode = '22023'; end if;
  update public.tickets set status = p_status, updated_at = now(),
    resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
  where id = t.id;
  insert into public.ticket_messages (ticket_id, author_role, body) values (t.id, 'system', 'Statut : ' || (labels ->> p_status) || '.');
  if p_status = 'resolved' then insert into public.notifications (user_id, ticket_id, kind) values (t.owner_id, t.id, 'ticket_resolved');
  elsif p_status in ('open', 'in_progress') and t.status in ('resolved', 'closed') then insert into public.notifications (user_id, ticket_id, kind) values (t.owner_id, t.id, 'ticket_reopened');
  end if;
  perform public._audit(case when p_status in ('resolved', 'closed') then 'ticket_closed' when t.status in ('resolved', 'closed') then 'ticket_reopened' else 'ticket_status' end,
    t.owner_id, t.id, jsonb_build_object('from', t.status, 'to', p_status), p_reason);
end $$;

-- L'utilisateur clôt (résolu) ou rouvre sa propre demande.
create function public.set_my_ticket_state(p_ticket uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); t public.tickets%rowtype;
begin
  select * into t from public.tickets x where x.id = p_ticket and x.owner_id = uid for update;
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  if p_action = 'resolve' then
    if t.status in ('resolved', 'closed') then return; end if;
    update public.tickets set status = 'resolved', resolved_at = now(), updated_at = now() where id = t.id;
    insert into public.ticket_messages (ticket_id, author_role, body) values (t.id, 'system', 'Marqué comme résolu par l''utilisateur.');
  elsif p_action = 'reopen' then
    if t.status not in ('resolved', 'closed') then return; end if;
    update public.tickets set status = 'open', resolved_at = null, updated_at = now() where id = t.id;
    insert into public.ticket_messages (ticket_id, author_role, body) values (t.id, 'system', 'Ticket rouvert par l''utilisateur.');
    perform public._notify_admins(t.id, 'ticket_reopened', uid);
  else raise exception 'action invalide' using errcode = '22023'; end if;
end $$;

create function public.mark_ticket_read(p_ticket uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  update public.tickets set owner_read_at = now() where id = p_ticket and owner_id = uid;
  if not found and public.is_admin() then update public.tickets set admin_read_at = now() where id = p_ticket; end if;
  update public.notifications set read_at = now() where user_id = uid and ticket_id = p_ticket and read_at is null;
end $$;

create function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null;
$$;

-- Accès refusé à /admin : trace (au plus une par minute et par compte).
create function public.log_admin_denied(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return; end if;
  if exists (select 1 from public.admin_audit a where a.actor_id = auth.uid() and a.action = 'admin_access_denied' and a.created_at > now() - interval '1 minute') then return; end if;
  perform public._audit('admin_access_denied', auth.uid(), null, jsonb_build_object('path', left(coalesce(p_path, ''), 200)), null);
end $$;

-- Écriture versionnée : refusée pour un compte suspendu (le reste est identique à la version initiale).
create or replace function public.save_state(p_state jsonb, p_base_version integer, p_client text default null)
returns table (ok boolean, version integer, state jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  cur public.user_data%rowtype;
begin
  if uid is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  if not public.account_active() then raise exception 'compte suspendu' using errcode = '42501'; end if;
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

-- Suppression de son compte : vérifie aussi les captures de support.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'non authentifié' using errcode = '28000'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id in ('user-files', 'support-files') and (storage.foldername(o.name))[1] = uid::text) then
    raise exception 'fichiers restants : supprimez-les d''abord' using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid;
end $$;

-- ================================================================ Administration : tableau de bord
create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'users_total', (select count(*) from auth.users),
    'signups_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'signups_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    -- Actif = connecté OU données synchronisées dans les 7 derniers jours.
    'active_7d', (select count(*) from auth.users u left join public.user_data d on d.user_id = u.id
                   where greatest(u.last_sign_in_at, d.updated_at) > now() - interval '7 days'),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'bugs_open', (select count(*) from public.tickets where kind = 'bug' and status not in ('resolved', 'closed')),
    'help_open', (select count(*) from public.tickets where kind = 'help' and status not in ('resolved', 'closed')),
    'awaiting_reply', (select count(*) from public.tickets where status not in ('resolved', 'closed', 'waiting_user') and last_message_by = 'user'),
    'resolved', (select count(*) from public.tickets where status in ('resolved', 'closed')),
    'critical_open', (select count(*) from public.tickets where priority = 'critical' and status not in ('resolved', 'closed')),
    'recent_tickets', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select t.id, t.number, t.kind, t.subject, t.status, t.priority, t.created_at from public.tickets t order by t.created_at desc limit 6) x),
    'priority_tickets', (select coalesce(jsonb_agg(x order by x.rank, x.created_at), '[]') from (
        select t.id, t.number, t.kind, t.subject, t.status, t.priority, t.created_at,
               case t.priority when 'critical' then 0 when 'high' then 1 else 2 end rank
        from public.tickets t where t.priority in ('critical', 'high') and t.status not in ('resolved', 'closed')
        order by rank, t.created_at limit 6) x),
    'recent_audit', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
        select a.id, a.actor_email, a.action, a.target_email, a.target_ticket, a.created_at from public.admin_audit a order by a.created_at desc limit 8) x)
  );
end $$;

create function public.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'email', u.email, 'name', coalesce(p.display_name, ''))), '[]')
          from public.user_roles r join auth.users u on u.id = r.user_id left join public.profiles p on p.id = u.id
          where lower(u.email) in (select a.email from public.admin_allowlist a) and u.email_confirmed_at is not null);
end $$;

-- ================================================================ Administration : utilisateurs
-- Vue interne des comptes pour l'administration (jamais exposée directement à l'API).
create function public._admin_users() returns table (
  id uuid, display_name text, email text, created_at timestamptz, email_confirmed_at timestamptz, last_activity timestamptz,
  status text, role text, open_tickets bigint, profile_updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(p.display_name, ''), u.email::text, u.created_at, u.email_confirmed_at,
         greatest(u.last_sign_in_at, d.updated_at), coalesce(p.status, 'active'),
         case when r.user_id is not null and u.email_confirmed_at is not null and lower(u.email) in (select a.email from public.admin_allowlist a) then 'admin' else 'user' end,
         (select count(*) from public.tickets t where t.owner_id = u.id and t.status not in ('resolved', 'closed')),
         p.updated_at
  from auth.users u left join public.profiles p on p.id = u.id left join public.user_data d on d.user_id = u.id
  left join public.user_roles r on r.user_id = u.id;
$$;

create function public.admin_list_users(p_q text default null, p_role text default null, p_status text default null,
  p_from date default null, p_to date default null, p_sort text default 'created_desc', p_page integer default 0, p_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(btrim(coalesce(p_q, '')), ''); res jsonb;
begin
  perform public._require_admin();
  p_size := least(greatest(coalesce(p_size, 25), 1), 100);
  p_page := greatest(coalesce(p_page, 0), 0);
  with f as (
    select * from public._admin_users() b where
      (q is null or b.email ilike '%' || q || '%' or b.display_name ilike '%' || q || '%' or b.id::text like lower(q) || '%')
      and (coalesce(p_role, '') = '' or b.role = p_role)
      and (coalesce(p_status, '') = '' or b.status = p_status)
      and (p_from is null or b.created_at >= p_from) and (p_to is null or b.created_at < p_to + 1)
  ), page as (
    select * from f order by
      case when p_sort = 'created_asc' then f.created_at end asc,
      case when p_sort = 'activity_desc' then f.last_activity end desc nulls last,
      case when p_sort = 'email_asc' then f.email end asc,
      case when p_sort = 'tickets_desc' then f.open_tickets end desc,
      f.created_at desc
    offset p_page * p_size limit p_size
  )
  select jsonb_build_object('total', (select count(*) from f), 'rows', coalesce((select jsonb_agg(to_jsonb(page)) from page), '[]')) into res;
  return res;
end $$;

-- Fiche détaillée : informations de compte nécessaires au support, résumé (comptes) des données, jamais leur contenu.
create function public.admin_get_user(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u record; s jsonb; res jsonb;
begin
  perform public._require_admin();
  select * into u from public._admin_users() x where x.id = p_user;
  if not found then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  select d.state into s from public.user_data d where d.user_id = p_user;
  res := jsonb_build_object(
    'user', to_jsonb(u),
    'account', (select jsonb_build_object('last_sign_in_at', a.last_sign_in_at, 'providers', coalesce(a.raw_app_meta_data -> 'providers', '[]'),
                 'banned_until', a.banned_until, 'new_email', a.email_change) from auth.users a where a.id = p_user),
    'profile', (select jsonb_build_object('status_reason', p.status_reason, 'status_changed_at', p.status_changed_at, 'created_at', p.created_at) from public.profiles p where p.id = p_user),
    'preferences', case when s is null then null else jsonb_build_object(
        'onboarded', s #> '{settings,onboarded}', 'theme', s #> '{settings,theme}', 'accent', s #> '{settings,accent}',
        'currency', s #> '{settings,currency}', 'hiddenViews', s #> '{settings,hiddenViews}') end,
    'data', (select jsonb_build_object('version', d.version, 'updated_at', d.updated_at, 'updated_by', d.updated_by,
        'counts', (select jsonb_object_agg(k, jsonb_array_length(d.state -> k)) from unnest(array['tasks','courses','classes','groceries','chores','sleep','focus','templates','products']) k where jsonb_typeof(d.state -> k) = 'array'),
        'expenses', jsonb_array_length(coalesce(d.state #> '{budget,expenses}', '[]')))
      from public.user_data d where d.user_id = p_user),
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'kind', t.kind, 'subject', t.subject, 'status', t.status, 'priority', t.priority, 'created_at', t.created_at) order by t.created_at desc), '[]') from public.tickets t where t.owner_id = p_user),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'author', (select e.email from auth.users e where e.id = n.author_id)) order by n.created_at desc), '[]') from public.user_notes n where n.user_id = p_user),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'actor_email', a.actor_email, 'summary', a.summary, 'reason', a.reason, 'created_at', a.created_at) order by a.created_at desc), '[]')
              from (select * from public.admin_audit a where a.target_user = p_user order by a.created_at desc limit 50) a)
  );
  perform public._audit('user_viewed', p_user, null, '{}', null);
  return res;
end $$;

create function public.admin_update_profile(p_user uuid, p_display_name text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare old text;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'justification obligatoire' using errcode = '22023'; end if;
  p_display_name := btrim(coalesce(p_display_name, ''));
  if char_length(p_display_name) > 80 then raise exception 'nom trop long' using errcode = '22023'; end if;
  select display_name into old from public.profiles where id = p_user for update;
  if not found then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  if old = p_display_name then return; end if;
  update public.profiles set display_name = p_display_name where id = p_user;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}') || jsonb_build_object('display_name', p_display_name) where id = p_user;
  perform public._audit('profile_updated', p_user, null, jsonb_build_object('field', 'display_name', 'from', old, 'to', p_display_name), btrim(p_reason));
end $$;

create function public.admin_add_user_note(p_user uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  insert into public.user_notes (user_id, author_id, body) values (p_user, auth.uid(), btrim(p_body));
  perform public._audit('user_note_added', p_user, null, jsonb_build_object('length', char_length(btrim(p_body))), null);
end $$;

-- Suspension / réactivation : statut du profil (écritures bloquées immédiatement) + bannissement Auth
-- (plus de connexion ni de renouvellement de session) + fermeture des sessions existantes.
create function public.admin_set_status(p_user uuid, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._require_admin(); old text;
begin
  if p_status not in ('active', 'suspended') then raise exception 'statut invalide' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'justification obligatoire' using errcode = '22023'; end if;
  if p_user = me then raise exception 'impossible de modifier son propre compte' using errcode = '42501'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user) then raise exception 'impossible de suspendre un administrateur' using errcode = '42501'; end if;
  select status into old from public.profiles where id = p_user for update;
  if not found then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  if old = p_status then return; end if;
  update public.profiles set status = p_status, status_reason = btrim(p_reason), status_changed_at = now(),
    deletion_requested_at = case when p_status = 'active' then null else deletion_requested_at end where id = p_user;
  if p_status = 'suspended' then
    update auth.users set banned_until = now() + interval '100 years' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  perform public._audit(case when p_status = 'suspended' then 'account_suspended' else 'account_reactivated' end, p_user, null,
    jsonb_build_object('from', old, 'to', p_status), btrim(p_reason));
end $$;

-- Réinitialisation du mot de passe : la base journalise et renvoie l'adresse ; l'e-mail est envoyé par le
-- parcours standard de Supabase Auth (lien à usage unique). Aucun mot de passe n'est jamais lisible.
create function public.admin_request_password_reset(p_user uuid, p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare em text;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'justification obligatoire' using errcode = '22023'; end if;
  select email into em from auth.users where id = p_user;
  if em is null then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  perform public._audit('password_reset_sent', p_user, null, '{}', btrim(p_reason));
  return em;
end $$;

-- Étape 1 de la suppression : le compte est suspendu (plus de connexion) et marqué « suppression en cours ».
-- C'est seulement à partir de là qu'un administrateur peut lister et supprimer ses fichiers.
create function public.admin_begin_deletion(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._require_admin();
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'justification obligatoire' using errcode = '22023'; end if;
  if p_user = me then raise exception 'impossible de supprimer son propre compte ici' using errcode = '42501'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user) then raise exception 'impossible de supprimer un administrateur' using errcode = '42501'; end if;
  update public.profiles set deletion_requested_at = coalesce(deletion_requested_at, now()), status = 'suspended',
    status_reason = 'Suppression en cours : ' || btrim(p_reason), status_changed_at = now() where id = p_user;
  if not found then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  update auth.users set banned_until = now() + interval '100 years' where id = p_user;
  delete from auth.sessions where user_id = p_user;
  perform public._audit('deletion_started', p_user, null, '{}', btrim(p_reason));
end $$;

-- Fichiers d'un compte en cours de suppression (noms seulement).
create function public.admin_user_files(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.profiles where id = p_user and deletion_requested_at is not null) then
    raise exception 'lancez d''abord la procédure de suppression' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'name', o.name)), '[]') from storage.objects o
          where o.bucket_id in ('user-files', 'support-files') and (storage.foldername(o.name))[1] = p_user::text);
end $$;

-- Suppression définitive d'un compte (après suppression de ses fichiers par l'API Storage).
create function public.admin_delete_user(p_user uuid, p_confirm_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public._require_admin(); em text;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'justification obligatoire' using errcode = '22023'; end if;
  if p_user = me then raise exception 'impossible de supprimer son propre compte ici' using errcode = '42501'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user) then raise exception 'impossible de supprimer un administrateur' using errcode = '42501'; end if;
  select email into em from auth.users where id = p_user;
  if em is null then raise exception 'utilisateur introuvable' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles where id = p_user and deletion_requested_at is not null) then
    raise exception 'lancez d''abord la procédure de suppression' using errcode = 'P0001';
  end if;
  if lower(btrim(coalesce(p_confirm_email, ''))) <> lower(em) then raise exception 'confirmation incorrecte' using errcode = '22023'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id in ('user-files', 'support-files') and (storage.foldername(o.name))[1] = p_user::text) then
    raise exception 'fichiers restants : supprimez-les d''abord' using errcode = 'P0001';
  end if;
  perform public._audit('account_deleted', p_user, null,
    jsonb_build_object('email', em, 'tickets', (select count(*) from public.tickets where owner_id = p_user)), btrim(p_reason));
  delete from auth.users where id = p_user;
end $$;

-- ================================================================ Correction ciblée des données (support)
-- Chemin lisible : {"tasks","id:abc123","title"} → les segments "id:…" désignent l'élément d'un tableau par son identifiant.
create function public._resolve_path(doc jsonb, p_path text[]) returns text[]
language plpgsql immutable set search_path = '' as $$
declare out text[] := '{}'; cur jsonb := doc; seg text; idx int;
begin
  if p_path is null or array_length(p_path, 1) is null or array_length(p_path, 1) > 6 then raise exception 'chemin invalide' using errcode = '22023'; end if;
  if p_path[1] not in ('settings', 'tasks', 'courses', 'classes', 'groceries', 'chores', 'sleep', 'focus', 'budget', 'templates', 'products') then
    raise exception 'section non modifiable' using errcode = '22023';
  end if;
  foreach seg in array p_path loop
    if jsonb_typeof(cur) = 'array' then
      if seg like 'id:%' then
        select (o.i - 1)::int into idx from jsonb_array_elements(cur) with ordinality o(e, i) where o.e ->> 'id' = substr(seg, 4) limit 1;
      elsif seg ~ '^\d+$' then idx := seg::int;
      else idx := null; end if;
      if idx is null or idx >= jsonb_array_length(cur) then raise exception 'élément introuvable : %', seg using errcode = 'P0002'; end if;
      out := out || idx::text; cur := cur -> idx;
    elsif jsonb_typeof(cur) = 'object' then
      if not (cur ? seg) then raise exception 'champ introuvable : %', seg using errcode = 'P0002'; end if;
      out := out || seg; cur := cur -> seg;
    else raise exception 'chemin invalide' using errcode = '22023'; end if;
  end loop;
  return out;
end $$;

create function public.admin_read_user_data(p_user uuid, p_path text[], p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s jsonb; real text[];
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'justification obligatoire (10 caractères minimum)' using errcode = '22023'; end if;
  select d.state into s from public.user_data d where d.user_id = p_user;
  if s is null then raise exception 'aucune donnée pour ce compte' using errcode = 'P0002'; end if;
  real := public._resolve_path(s, p_path);
  perform public._audit('data_viewed', p_user, null, jsonb_build_object('path', to_jsonb(p_path)), btrim(p_reason));
  return s #> real;
end $$;

-- Remplace UNE valeur existante, seulement si elle n'a pas changé depuis la lecture (p_expected).
create function public.admin_fix_user_data(p_user uuid, p_path text[], p_expected jsonb, p_value jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.user_data%rowtype; real text[]; cur jsonb;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'justification obligatoire (10 caractères minimum)' using errcode = '22023'; end if;
  if p_value is null then raise exception 'nouvelle valeur manquante' using errcode = '22023'; end if;
  select * into d from public.user_data x where x.user_id = p_user for update;
  if not found then raise exception 'aucune donnée pour ce compte' using errcode = 'P0002'; end if;
  real := public._resolve_path(d.state, p_path);
  cur := d.state #> real;
  if cur is distinct from p_expected then raise exception 'la valeur a changé depuis la lecture : relisez-la' using errcode = 'P0001'; end if;
  if jsonb_typeof(cur) <> jsonb_typeof(p_value) and not (jsonb_typeof(cur) = 'null' or jsonb_typeof(p_value) = 'null') then
    raise exception 'type de valeur différent (% attendu)', jsonb_typeof(cur) using errcode = '22023';
  end if;
  update public.user_data set state = jsonb_set(d.state, real, p_value, false), version = d.version + 1, updated_at = now(), updated_by = 'admin'
    where user_id = p_user;
  perform public._audit('data_fixed', p_user, null, jsonb_build_object('path', to_jsonb(p_path), 'resolved', to_jsonb(real), 'from', cur, 'to', p_value), btrim(p_reason));
  return jsonb_build_object('version', d.version + 1);
end $$;

-- Annule une correction si la valeur n'a pas été modifiée depuis (sinon refus : rien n'est écrasé).
create function public.admin_revert_data_fix(p_audit bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.admin_audit%rowtype; d public.user_data%rowtype; real text[];
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'justification obligatoire (10 caractères minimum)' using errcode = '22023'; end if;
  select * into a from public.admin_audit where id = p_audit and action = 'data_fixed';
  if not found then raise exception 'correction introuvable' using errcode = 'P0002'; end if;
  select * into d from public.user_data where user_id = a.target_user for update;
  if not found then raise exception 'aucune donnée pour ce compte' using errcode = 'P0002'; end if;
  real := array(select jsonb_array_elements_text(a.summary -> 'resolved'));
  if (d.state #> real) is distinct from (a.summary -> 'to') then raise exception 'la valeur a changé depuis la correction : annulation impossible sans risque' using errcode = 'P0001'; end if;
  update public.user_data set state = jsonb_set(d.state, real, a.summary -> 'from', false), version = d.version + 1, updated_at = now(), updated_by = 'admin'
    where user_id = a.target_user;
  perform public._audit('data_fix_reverted', a.target_user, null, jsonb_build_object('audit_id', a.id, 'path', a.summary -> 'path', 'from', a.summary -> 'to', 'to', a.summary -> 'from'), btrim(p_reason));
end $$;

-- ================================================================ Administration : tickets
create function public.admin_list_tickets(p_q text default null, p_kind text default null, p_status text default null, p_priority text default null,
  p_owner uuid default null, p_assigned text default null, p_sort text default 'activity', p_page integer default 0, p_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(btrim(coalesce(p_q, '')), ''); me uuid := public._require_admin(); res jsonb;
begin
  p_size := least(greatest(coalesce(p_size, 25), 1), 100);
  p_page := greatest(coalesce(p_page, 0), 0);
  with f as (
    select t.id, t.number, t.kind, t.category, t.subject, t.status, t.priority, t.module, t.created_at, t.updated_at, t.last_message_at, t.last_message_by,
           t.owner_id, u.email as owner_email, coalesce(p.display_name, '') as owner_name, t.assigned_to, (select e.email from auth.users e where e.id = t.assigned_to) as assigned_email,
           (t.last_message_by = 'user' and (t.admin_read_at is null or t.admin_read_at < t.last_message_at)) as unread,
           case t.priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as prank
    from public.tickets t join auth.users u on u.id = t.owner_id left join public.profiles p on p.id = t.owner_id
    where (q is null or t.subject ilike '%' || q || '%' or t.description ilike '%' || q || '%' or u.email ilike '%' || q || '%' or t.number::text = ltrim(q, '#'))
      and (coalesce(p_kind, '') = '' or t.kind = p_kind)
      and (coalesce(p_status, '') = '' or t.status = p_status or (p_status = 'active' and t.status not in ('resolved', 'closed')))
      and (coalesce(p_priority, '') = '' or t.priority = p_priority)
      and (p_owner is null or t.owner_id = p_owner)
      and (coalesce(p_assigned, '') = '' or (p_assigned = 'me' and t.assigned_to = me) or (p_assigned = 'none' and t.assigned_to is null))
  ), page as (
    select * from f order by
      case when p_sort = 'priority' then f.prank end asc,
      case when p_sort = 'old' then f.created_at end asc,
      case when p_sort = 'new' then f.created_at end desc,
      f.last_message_at desc
    offset p_page * p_size limit p_size
  )
  select jsonb_build_object('total', (select count(*) from f), 'rows', coalesce((select jsonb_agg(to_jsonb(page) - 'prank') from page), '[]')) into res;
  return res;
end $$;

create function public.admin_get_ticket(p_ticket uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object(
    'ticket', to_jsonb(t) || jsonb_build_object('owner_email', u.email, 'owner_name', coalesce(p.display_name, ''), 'owner_status', coalesce(p.status, 'active')),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at, 'author', (select e.email from auth.users e where e.id = n.author_id)) order by n.created_at), '[]') from public.ticket_notes n where n.ticket_id = t.id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'actor_email', a.actor_email, 'summary', a.summary, 'reason', a.reason, 'created_at', a.created_at) order by a.created_at desc), '[]') from public.admin_audit a where a.target_ticket = t.id)
  ) into res
  from public.tickets t join auth.users u on u.id = t.owner_id left join public.profiles p on p.id = t.owner_id where t.id = p_ticket;
  if res is null then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  return res;
end $$;

create function public.admin_update_ticket(p_ticket uuid, p_status text default null, p_priority text default null,
  p_assigned uuid default null, p_unassign boolean default false, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tickets%rowtype;
begin
  perform public._require_admin();
  select * into t from public.tickets where id = p_ticket for update;
  if not found then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  if p_priority is not null and p_priority <> t.priority then
    if p_priority not in ('low', 'normal', 'high', 'critical') then raise exception 'priorité invalide' using errcode = '22023'; end if;
    update public.tickets set priority = p_priority, updated_at = now() where id = t.id;
    perform public._audit('ticket_priority', t.owner_id, t.id, jsonb_build_object('from', t.priority, 'to', p_priority), p_reason);
  end if;
  if p_unassign and t.assigned_to is not null then
    update public.tickets set assigned_to = null, updated_at = now() where id = t.id;
    perform public._audit('ticket_assigned', t.owner_id, t.id, jsonb_build_object('from', (select email from auth.users where id = t.assigned_to), 'to', null), p_reason);
  elsif p_assigned is not null and p_assigned is distinct from t.assigned_to then
    if not exists (select 1 from public.user_roles r join auth.users u on u.id = r.user_id where r.user_id = p_assigned
                   and lower(u.email) in (select a.email from public.admin_allowlist a)) then
      raise exception 'un ticket ne peut être assigné qu''à un administrateur' using errcode = '22023';
    end if;
    update public.tickets set assigned_to = p_assigned, updated_at = now() where id = t.id;
    perform public._audit('ticket_assigned', t.owner_id, t.id, jsonb_build_object('from', (select email from auth.users where id = t.assigned_to), 'to', (select email from auth.users where id = p_assigned)), p_reason);
  end if;
  if p_status is not null and p_status <> t.status then
    perform public._apply_status(t, p_status, p_reason);
  end if;
end $$;

create function public.admin_add_ticket_note(p_ticket uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  perform public._require_admin();
  select owner_id into o from public.tickets where id = p_ticket;
  if o is null then raise exception 'ticket introuvable' using errcode = 'P0002'; end if;
  insert into public.ticket_notes (ticket_id, author_id, body) values (p_ticket, auth.uid(), btrim(p_body));
  perform public._audit('ticket_note_added', o, p_ticket, jsonb_build_object('length', char_length(btrim(p_body))), null);
end $$;

-- ================================================================ Droits d'exécution
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'is_admin', 'account_active', 'audit_immutable', '_audit', 'sync_admin_role', 'sync_admin_roles', '_require_admin', '_require_active',
             '_notify_admins', '_check_attachment', '_apply_status', '_admin_users', '_resolve_path',
             'my_role', 'create_ticket', 'post_message', 'set_my_ticket_state', 'mark_ticket_read', 'mark_notifications_read', 'log_admin_denied',
             'admin_stats', 'admin_list_admins', 'admin_list_users', 'admin_get_user', 'admin_update_profile', 'admin_add_user_note', 'admin_set_status',
             'admin_request_password_reset', 'admin_begin_deletion', 'admin_user_files', 'admin_delete_user', 'admin_read_user_data', 'admin_fix_user_data', 'admin_revert_data_fix',
             'admin_list_tickets', 'admin_get_ticket', 'admin_update_ticket', 'admin_add_ticket_note')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    -- Fonctions appelables par un utilisateur connecté (chacune revérifie l'identité et les droits).
    -- is_admin / account_active sont utilisées par les politiques RLS : elles doivent rester exécutables.
    if f.proname in ('is_admin', 'account_active', 'my_role', 'create_ticket', 'post_message', 'set_my_ticket_state', 'mark_ticket_read',
                     'mark_notifications_read', 'log_admin_denied') or f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
revoke all on function public.save_state(jsonb, integer, text) from public, anon;
grant execute on function public.save_state(jsonb, integer, text) to authenticated;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ================================================================ Stockage : captures d'écran du support
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-files', 'support-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']);

create policy "support : ajout dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'support-files' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(storage.extension(name)) in ('png', 'jpg', 'jpeg', 'webp'));
-- Lecture : ses propres fichiers, ceux joints à SES tickets (réponses des administrateurs), ou administrateur.
create policy "support : lecture autorisée" on storage.objects for select to authenticated
  using (bucket_id = 'support-files' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
    or exists (select 1 from public.ticket_messages m join public.tickets t on t.id = m.ticket_id
               where m.attachment_path = name and t.owner_id = (select auth.uid()))));
create policy "support : suppression des siens" on storage.objects for delete to authenticated
  using (bucket_id = 'support-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- Procédure de suppression d'un compte par un administrateur : uniquement pour un compte dont la suppression
-- a été lancée (admin_begin_deletion, journalisé). La suppression Storage exige aussi la visibilité (SELECT).
create function public.deletion_pending(p_folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id::text = p_folder and p.deletion_requested_at is not null);
$$;
revoke all on function public.deletion_pending(text) from public, anon;
grant execute on function public.deletion_pending(text) to authenticated;
create policy "fichiers : visibles par un admin pendant une suppression" on storage.objects for select to authenticated
  using (bucket_id = 'user-files' and (select public.is_admin()) and public.deletion_pending((storage.foldername(name))[1]));
create policy "fichiers : suppression par un admin pendant une suppression" on storage.objects for delete to authenticated
  using (bucket_id in ('user-files', 'support-files') and (select public.is_admin()) and public.deletion_pending((storage.foldername(name))[1]));
