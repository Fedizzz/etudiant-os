-- Étudiant.OS — ménage partagé de la colocation : corvées communes visibles par tous les colocataires, rotation, « fait par ».
-- Migration ADDITIVE (suite de 20261019000001_flats.sql) : aucune table existante n'est modifiée.
-- Même modèle de sécurité : lecture réservée aux membres actifs (RLS), écriture uniquement par des fonctions SECURITY DEFINER.

create table public.flat_chores (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  recurrence text not null check (recurrence in ('daily', 'weekly', 'biweekly', 'once')),
  day smallint not null default 0 check (day between 0 and 6),   -- 0 = lundi (comme l'application)
  due_on date,                                                     -- obligatoire pour « once »
  minutes integer not null default 20 check (minutes between 1 and 600),
  rotation jsonb not null default '[]' check (jsonb_typeof(rotation) = 'array' and jsonb_array_length(rotation) between 0 and 8),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check ((recurrence = 'once') = (due_on is not null))
);
create index flat_chores_flat on public.flat_chores (flat_id);

create table public.flat_chore_done (
  chore_id uuid not null references public.flat_chores (id) on delete cascade,
  flat_id uuid not null references public.flats (id) on delete cascade,
  done_on date not null,
  done_by uuid not null,
  done_at timestamptz not null default now(),
  primary key (chore_id, done_on)
);
create index flat_chore_done_flat on public.flat_chore_done (flat_id, done_on desc);

alter table public.flat_chores enable row level security;
alter table public.flat_chore_done enable row level security;
revoke all on public.flat_chores, public.flat_chore_done from anon, authenticated, public;
grant select on public.flat_chores, public.flat_chore_done to authenticated;
create policy "corvées communes : lecture par les membres" on public.flat_chores for select to authenticated using (public.is_flat_member(flat_id));
create policy "corvées faites : lecture par les membres" on public.flat_chore_done for select to authenticated using (public.is_flat_member(flat_id));

create function public.add_flat_chore(p_name text, p_recurrence text, p_day integer, p_due date, p_minutes integer, p_rotation jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); cid uuid; k jsonb;
begin
  if p_recurrence not in ('daily', 'weekly', 'biweekly', 'once') then raise exception 'récurrence invalide' using errcode = '22023'; end if;
  if p_recurrence = 'once' and (p_due is null or p_due < date '2000-01-01' or p_due > current_date + 366) then raise exception 'date invalide' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_rotation, '[]'::jsonb)) <> 'array' then raise exception 'rotation invalide' using errcode = '22023'; end if;
  for k in select * from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) loop
    if jsonb_typeof(k) <> 'string' or (k #>> '{}') !~ '^[0-9a-f-]{36}$'
       or not exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = (k #>> '{}')::uuid and m.left_at is null) then
      raise exception 'un participant n''est pas membre' using errcode = '22023';
    end if;
  end loop;
  insert into public.flat_chores (flat_id, name, recurrence, day, due_on, minutes, rotation, created_by)
    values (fid, public._clean_name(p_name, 80, 'nom de corvée'), p_recurrence, coalesce(p_day, 0), case when p_recurrence = 'once' then p_due end, coalesce(p_minutes, 20), coalesce(p_rotation, '[]'::jsonb), uid)
    returning id into cid;
  return cid;
end $$;

create function public.remove_flat_chore(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat();
begin
  delete from public.flat_chores c where c.id = p_id and c.flat_id = fid
    and (c.created_by = uid or exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner'));
end $$;

-- Coche (ou décoche) une corvée pour un jour. Cocher : n'importe quel membre (l'auteur est enregistré). Décocher : celui qui l'a cochée ou le propriétaire.
create function public.set_flat_chore_done(p_id uuid, p_date date, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat();
begin
  if not exists (select 1 from public.flat_chores c where c.id = p_id and c.flat_id = fid) then raise exception 'corvée introuvable' using errcode = 'P0001'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 120 then raise exception 'date invalide' using errcode = '22023'; end if;
  if p_done then
    insert into public.flat_chore_done (chore_id, flat_id, done_on, done_by) values (p_id, fid, p_date, uid) on conflict (chore_id, done_on) do nothing;
  else
    delete from public.flat_chore_done d where d.chore_id = p_id and d.done_on = p_date
      and (d.done_by = uid or exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner'));
  end if;
end $$;

revoke all on function public.add_flat_chore(text, text, integer, date, integer, jsonb), public.remove_flat_chore(uuid), public.set_flat_chore_done(uuid, date, boolean) from public, anon;
grant execute on function public.add_flat_chore(text, text, integer, date, integer, jsonb), public.remove_flat_chore(uuid), public.set_flat_chore_done(uuid, date, boolean) to authenticated;
