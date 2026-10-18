-- Étudiant.OS — colocation : appartement partagé, liste de courses commune, dépenses partagées (« qui doit combien à qui »).
--
-- Migration ADDITIVE : aucune table existante n'est modifiée ni supprimée ; user_data (données personnelles) reste intact.
-- Sécurité :
--   * Les tables n'ont aucun droit INSERT/UPDATE/DELETE pour les clients : toute écriture passe par des fonctions
--     SECURITY DEFINER qui vérifient auth.uid(), l'appartenance à l'appartement et la cohérence des montants.
--   * Lecture : réservée aux membres actifs de l'appartement (RLS via is_flat_member).
--   * Un utilisateur a au plus UN appartement actif. Rejoindre demande un code d'invitation (10 caractères aléatoires,
--     15 essais par heure et par utilisateur, 8 membres maximum). Le propriétaire peut régénérer le code ou retirer un membre.
--   * Montants en centimes entiers. Les identifiants d'utilisateur des dépenses ne sont PAS des clés étrangères :
--     supprimer un compte ne supprime jamais l'historique des autres colocataires (le nom reste dans flat_members.display_name
--     tant que la ligne existe ; à la suppression du compte la ligne disparaît et l'historique affiche « ancien membre »).

-- ================================================================ Tables
create table public.flats (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{10}$'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.flat_members (
  flat_id uuid not null references public.flats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (flat_id, user_id)
);
-- Un seul appartement actif par utilisateur.
create unique index flat_members_one_active on public.flat_members (user_id) where left_at is null;

create table public.flat_groceries (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  aisle text not null default 'Épicerie' check (char_length(aisle) between 1 and 40),
  qty text not null default '' check (char_length(qty) <= 40),
  checked boolean not null default false,
  price_cents integer not null default 0 check (price_cents between 0 and 10000000),
  added_by uuid not null,
  updated_at timestamptz not null default now()
);
create index flat_groceries_flat on public.flat_groceries (flat_id);

create table public.flat_expenses (
  id uuid primary key default gen_random_uuid(),
  flat_id uuid not null references public.flats (id) on delete cascade,
  -- expense : dépense partagée · payment : remboursement d'un colocataire à un autre (même formule de solde)
  kind text not null default 'expense' check (kind in ('expense', 'payment')),
  paid_by uuid not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  label text not null default '' check (char_length(label) <= 120),
  spent_on date not null,
  -- { "<user_id>": centimes } : part de chacun ; la somme est égale à amount_cents (vérifié par add_flat_expense).
  shares jsonb not null check (jsonb_typeof(shares) = 'object'),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 200),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index flat_expenses_flat on public.flat_expenses (flat_id, spent_on desc);

create table public.flat_join_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index flat_join_log_user on public.flat_join_log (user_id, at desc);

-- ================================================================ Droits et RLS
alter table public.flats enable row level security;
alter table public.flat_members enable row level security;
alter table public.flat_groceries enable row level security;
alter table public.flat_expenses enable row level security;
alter table public.flat_join_log enable row level security;
revoke all on public.flats, public.flat_members, public.flat_groceries, public.flat_expenses, public.flat_join_log from anon, authenticated, public;

-- Vrai si l'appelant est membre actif de l'appartement (SECURITY DEFINER : pas de récursion de RLS).
create function public.is_flat_member(p_flat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.flat_members m where m.flat_id = p_flat and m.user_id = auth.uid() and m.left_at is null);
$$;
revoke all on function public.is_flat_member(uuid) from public, anon;
grant execute on function public.is_flat_member(uuid) to authenticated;

grant select on public.flats, public.flat_members, public.flat_groceries, public.flat_expenses to authenticated;
create policy "appartement : lecture par les membres" on public.flats for select to authenticated using (public.is_flat_member(id));
create policy "membres : lecture par les membres" on public.flat_members for select to authenticated using (public.is_flat_member(flat_id));
create policy "courses communes : lecture par les membres" on public.flat_groceries for select to authenticated using (public.is_flat_member(flat_id));
create policy "dépenses communes : lecture par les membres" on public.flat_expenses for select to authenticated using (public.is_flat_member(flat_id));
-- flat_join_log : aucune politique, aucun droit (usage interne).

-- ================================================================ Utilitaires internes
-- Appartement actif de l'appelant (exception si aucun).
create function public._my_flat() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare f uuid;
begin
  select m.flat_id into f from public.flat_members m where m.user_id = auth.uid() and m.left_at is null;
  if f is null then raise exception 'vous n''avez pas d''appartement' using errcode = 'P0001'; end if;
  return f;
end $$;

create function public._new_invite_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare c text;
begin
  loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.flats f where f.invite_code = c);
  end loop;
  return c;
end $$;

create function public._clean_name(p text, p_max int, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, ''));
begin
  if char_length(s) < 1 or char_length(s) > p_max then raise exception '% invalide', p_what using errcode = '22023'; end if;
  return s;
end $$;
revoke all on function public._my_flat(), public._new_invite_code(), public._clean_name(text, int, text) from public, anon, authenticated;

-- ================================================================ Appartement
create function public.create_flat(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid;
begin
  if exists (select 1 from public.flat_members m where m.user_id = uid and m.left_at is null) then
    raise exception 'vous avez déjà un appartement' using errcode = 'P0001';
  end if;
  insert into public.flats (name, invite_code, created_by)
    values (public._clean_name(p_name, 60, 'nom d''appartement'), public._new_invite_code(), uid) returning id into fid;
  insert into public.flat_members (flat_id, user_id, display_name, role)
    values (fid, uid, public._clean_name(p_display_name, 80, 'nom'), 'owner');
  return fid;
end $$;

create function public.join_flat(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); f public.flats%rowtype; code text := upper(btrim(coalesce(p_code, '')));
begin
  if (select count(*) from public.flat_join_log l where l.user_id = uid and l.at > now() - interval '1 hour') >= 15 then
    raise exception 'trop d''essais : réessayez dans une heure' using errcode = 'P0001';
  end if;
  insert into public.flat_join_log (user_id) values (uid);
  if exists (select 1 from public.flat_members m where m.user_id = uid and m.left_at is null) then
    raise exception 'vous avez déjà un appartement' using errcode = 'P0001';
  end if;
  select * into f from public.flats x where x.invite_code = code;
  -- Code inconnu : on RENVOIE null (sans exception) pour que l'essai reste compté dans flat_join_log ; une exception annulerait l'INSERT du journal.
  if not found then return null; end if;
  if (select count(*) from public.flat_members m where m.flat_id = f.id and m.left_at is null) >= 8 then
    raise exception 'appartement complet (8 membres)' using errcode = 'P0001';
  end if;
  insert into public.flat_members (flat_id, user_id, display_name, role)
    values (f.id, uid, public._clean_name(p_display_name, 80, 'nom'), 'member')
    on conflict (flat_id, user_id) do update set left_at = null, display_name = excluded.display_name, joined_at = now(), role = 'member';
  return f.id;
end $$;

create function public.leave_flat() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); my public.flat_members%rowtype; heir uuid;
begin
  select * into my from public.flat_members m where m.flat_id = fid and m.user_id = uid;
  update public.flat_members m set left_at = now() where m.flat_id = fid and m.user_id = uid;
  if my.role = 'owner' then
    select m.user_id into heir from public.flat_members m where m.flat_id = fid and m.left_at is null order by m.joined_at limit 1;
    if heir is null then delete from public.flats f where f.id = fid;  -- dernier membre : l'appartement disparaît
    else update public.flat_members m set role = 'owner' where m.flat_id = fid and m.user_id = heir; update public.flat_members m set role = 'member' where m.flat_id = fid and m.user_id = uid; end if;
  end if;
end $$;

create function public.regenerate_invite_code() returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); c text;
begin
  if not exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner') then
    raise exception 'réservé au propriétaire' using errcode = '42501';
  end if;
  c := public._new_invite_code();
  update public.flats f set invite_code = c where f.id = fid;
  return c;
end $$;

create function public.remove_flat_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat();
begin
  if not exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner') then
    raise exception 'réservé au propriétaire' using errcode = '42501';
  end if;
  if p_user = uid then raise exception 'utilisez « quitter l''appartement »' using errcode = '22023'; end if;
  update public.flat_members m set left_at = now() where m.flat_id = fid and m.user_id = p_user and m.left_at is null;
end $$;

-- Appartement actif de l'appelant, avec ses membres (anciens membres inclus : noms de l'historique) ; null si aucun.
create function public.my_flat() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := public._require_active(); f public.flats%rowtype;
begin
  select x.* into f from public.flats x join public.flat_members m on m.flat_id = x.id where m.user_id = uid and m.left_at is null;
  if not found then return null; end if;
  return jsonb_build_object('id', f.id, 'name', f.name, 'invite_code', f.invite_code, 'me', uid,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name, 'role', m.role, 'left', m.left_at is not null) order by m.joined_at), '[]'::jsonb)
                from public.flat_members m where m.flat_id = f.id));
end $$;

-- ================================================================ Courses communes
create function public.add_flat_grocery(p_name text, p_aisle text, p_qty text, p_price_cents integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); gid uuid;
begin
  insert into public.flat_groceries (flat_id, name, aisle, qty, price_cents, added_by)
    values (fid, public._clean_name(p_name, 120, 'article'), coalesce(nullif(btrim(p_aisle), ''), 'Épicerie'), coalesce(btrim(p_qty), ''), coalesce(p_price_cents, 0), uid) returning id into gid;
  return gid;
end $$;

create function public.set_flat_grocery(p_id uuid, p_checked boolean, p_price_cents integer) returns void
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public._my_flat();
begin
  perform public._require_active();
  update public.flat_groceries g set checked = coalesce(p_checked, g.checked), price_cents = coalesce(p_price_cents, g.price_cents), updated_at = now()
    where g.id = p_id and g.flat_id = fid;
end $$;

create function public.remove_flat_grocery(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare fid uuid := public._my_flat();
begin
  perform public._require_active();
  delete from public.flat_groceries g where g.id = p_id and g.flat_id = fid;
end $$;

-- ================================================================ Dépenses communes
-- Contrôles : payeur et parts = membres actifs ; parts entières ≥ 0 ; somme = montant ; au moins une part > 0.
create function public._check_shares(p_flat uuid, p_paid_by uuid, p_amount integer, p_shares jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare k text; v jsonb; total bigint := 0; positive boolean := false;
begin
  if p_amount is null or p_amount < 1 then raise exception 'montant invalide' using errcode = '22023'; end if;
  if jsonb_typeof(p_shares) is distinct from 'object' then raise exception 'répartition invalide' using errcode = '22023'; end if;
  if not exists (select 1 from public.flat_members m where m.flat_id = p_flat and m.user_id = p_paid_by and m.left_at is null) then
    raise exception 'le payeur n''est pas un membre' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_shares) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^\d+$' then raise exception 'part invalide' using errcode = '22023'; end if;
    if k !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.flat_members m where m.flat_id = p_flat and m.user_id = k::uuid and m.left_at is null) then
      raise exception 'un participant n''est pas membre' using errcode = '22023';
    end if;
    total := total + (v #>> '{}')::bigint;
    if (v #>> '{}')::bigint > 0 then positive := true; end if;
  end loop;
  if total <> p_amount or not positive then raise exception 'la somme des parts doit être égale au montant' using errcode = '22023'; end if;
end $$;
revoke all on function public._check_shares(uuid, uuid, integer, jsonb) from public, anon, authenticated;

create function public.add_flat_expense(p_amount_cents integer, p_label text, p_date date, p_paid_by uuid, p_shares jsonb, p_kind text default 'expense', p_items jsonb default '[]') returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); eid uuid;
begin
  if p_kind not in ('expense', 'payment') then raise exception 'type invalide' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date + 1 or p_date < date '2000-01-01' then raise exception 'date invalide' using errcode = '22023'; end if;
  perform public._check_shares(fid, p_paid_by, p_amount_cents, p_shares);
  insert into public.flat_expenses (flat_id, kind, paid_by, amount_cents, label, spent_on, shares, items, created_by)
    values (fid, p_kind, p_paid_by, p_amount_cents, left(btrim(coalesce(p_label, '')), 120), p_date, p_shares, coalesce(p_items, '[]'), uid) returning id into eid;
  return eid;
end $$;

-- Supprime une dépense : son auteur ou le propriétaire.
create function public.remove_flat_expense(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat();
begin
  delete from public.flat_expenses e where e.id = p_id and e.flat_id = fid
    and (e.created_by = uid or exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner'));
end $$;

-- « Valider les achats » de la liste commune : crée la dépense partagée et retire les articles cochés, en une seule opération.
create function public.flat_checkout(p_amount_cents integer, p_label text, p_date date, p_paid_by uuid, p_shares jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); eid uuid; names jsonb;
begin
  select coalesce(jsonb_agg(g.name order by g.updated_at), '[]'::jsonb) into names from public.flat_groceries g where g.flat_id = fid and g.checked;
  if jsonb_array_length(names) = 0 then raise exception 'aucun article coché' using errcode = 'P0001'; end if;
  eid := public.add_flat_expense(p_amount_cents, p_label, p_date, p_paid_by, p_shares, 'expense', names);
  delete from public.flat_groceries g where g.flat_id = fid and g.checked;
  return eid;
end $$;

-- ================================================================ Exécution des fonctions
revoke all on function
  public.create_flat(text, text), public.join_flat(text, text), public.leave_flat(), public.regenerate_invite_code(), public.remove_flat_member(uuid), public.my_flat(),
  public.add_flat_grocery(text, text, text, integer), public.set_flat_grocery(uuid, boolean, integer), public.remove_flat_grocery(uuid),
  public.add_flat_expense(integer, text, date, uuid, jsonb, text, jsonb), public.remove_flat_expense(uuid), public.flat_checkout(integer, text, date, uuid, jsonb)
  from public, anon;
grant execute on function
  public.create_flat(text, text), public.join_flat(text, text), public.leave_flat(), public.regenerate_invite_code(), public.remove_flat_member(uuid), public.my_flat(),
  public.add_flat_grocery(text, text, text, integer), public.set_flat_grocery(uuid, boolean, integer), public.remove_flat_grocery(uuid),
  public.add_flat_expense(integer, text, date, uuid, jsonb, text, jsonb), public.remove_flat_expense(uuid), public.flat_checkout(integer, text, date, uuid, jsonb)
  to authenticated;
