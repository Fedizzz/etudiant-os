-- Étudiant.OS — ménage de la colocation « comme le ménage personnel » : heure fixe, checklist d'étapes, report d'un jour, étapes cochées par jour,
-- date réelle du coche (retard). Suite de 20261020000001_flat_chores.sql. Migration ADDITIVE : colonnes avec valeurs par défaut, anciennes fonctions conservées.
-- Sécurité inchangée : écriture uniquement par des fonctions SECURITY DEFINER réservées aux membres actifs de l'appartement.

alter table public.flat_chores
  add column time text check (time is null or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 40);

-- Une ligne par (corvée, jour) : fait (done_by renseigné), reporté (skipped) et/ou étapes cochées. done_by devient facultatif.
alter table public.flat_chore_done alter column done_by drop not null;
alter table public.flat_chore_done
  add column skipped boolean not null default false,
  add column steps_done jsonb not null default '[]' check (jsonb_typeof(steps_done) = 'array' and jsonb_array_length(steps_done) <= 40),
  add column ticked_on date;   -- jour réel où la case a été cochée (coché après son jour = en retard)

-- Crée (p_id null) ou modifie une corvée commune. Modifier : n'importe quel membre actif (étapes, heure…) ; la rotation doit rester composée de membres actifs.
create function public.save_flat_chore(p_id uuid, p_name text, p_recurrence text, p_day integer, p_due date, p_minutes integer, p_time text, p_steps jsonb, p_rotation jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); cid uuid; k jsonb; v_steps jsonb := '[]'::jsonb; s jsonb;
begin
  if p_recurrence not in ('daily', 'weekly', 'biweekly', 'once') then raise exception 'récurrence invalide' using errcode = '22023'; end if;
  if p_recurrence = 'once' and (p_due is null or p_due < date '2000-01-01' or p_due > current_date + 366) then raise exception 'date invalide' using errcode = '22023'; end if;
  if p_time is not null and p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'heure invalide' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_rotation, '[]'::jsonb)) <> 'array' then raise exception 'rotation invalide' using errcode = '22023'; end if;
  for k in select * from jsonb_array_elements(coalesce(p_rotation, '[]'::jsonb)) loop
    if jsonb_typeof(k) <> 'string' or (k #>> '{}') !~ '^[0-9a-f-]{36}$'
       or not exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = (k #>> '{}')::uuid and m.left_at is null) then
      raise exception 'un participant n''est pas membre' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' then raise exception 'étapes invalides' using errcode = '22023'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(s -> 'id') <> 'string' or jsonb_typeof(s -> 'text') <> 'string' or char_length(s ->> 'id') > 40
       or char_length(btrim(s ->> 'text')) not between 1 and 120 then raise exception 'étape invalide' using errcode = '22023'; end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('id', s ->> 'id', 'text', btrim(s ->> 'text')));
  end loop;
  if jsonb_array_length(v_steps) > 40 then raise exception 'trop d''étapes (40 maximum)' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.flat_chores (flat_id, name, recurrence, day, due_on, minutes, time, steps, rotation, created_by)
      values (fid, public._clean_name(p_name, 80, 'nom de corvée'), p_recurrence, coalesce(p_day, 0), case when p_recurrence = 'once' then p_due end, coalesce(p_minutes, 20), p_time, v_steps, coalesce(p_rotation, '[]'::jsonb), uid)
      returning id into cid;
  else
    update public.flat_chores c set name = public._clean_name(p_name, 80, 'nom de corvée'), recurrence = p_recurrence, day = coalesce(p_day, 0),
      due_on = case when p_recurrence = 'once' then p_due end, minutes = coalesce(p_minutes, 20), time = p_time, steps = v_steps, rotation = coalesce(p_rotation, '[]'::jsonb)
      where c.id = p_id and c.flat_id = fid returning c.id into cid;
    if cid is null then raise exception 'corvée introuvable' using errcode = 'P0001'; end if;
  end if;
  return cid;
end $$;

-- État d'un jour d'une corvée : fait / reporté / étapes cochées (null = inchangé). Cocher enregistre l'auteur (l'appelant) et le jour réel du coche.
-- Décocher : celui qui a coché ou le propriétaire. La ligne disparaît quand elle ne contient plus rien.
create function public.set_flat_chore_day(p_id uuid, p_date date, p_done boolean default null, p_skipped boolean default null, p_steps_done jsonb default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._require_active(); fid uuid := public._my_flat(); cur public.flat_chore_done%rowtype; is_owner boolean; new_by uuid; new_ticked date; new_steps jsonb; new_skip boolean;
begin
  if not exists (select 1 from public.flat_chores c where c.id = p_id and c.flat_id = fid) then raise exception 'corvée introuvable' using errcode = 'P0001'; end if;
  if p_date is null or p_date > current_date + 60 or p_date < current_date - 120 then raise exception 'date invalide' using errcode = '22023'; end if;
  if p_steps_done is not null and (jsonb_typeof(p_steps_done) <> 'array' or jsonb_array_length(p_steps_done) > 40
     or exists (select 1 from jsonb_array_elements(p_steps_done) e where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 40)) then
    raise exception 'étapes invalides' using errcode = '22023';
  end if;
  select exists (select 1 from public.flat_members m where m.flat_id = fid and m.user_id = uid and m.role = 'owner') into is_owner;
  select * into cur from public.flat_chore_done d where d.chore_id = p_id and d.done_on = p_date for update;
  new_by := cur.done_by; new_ticked := cur.ticked_on; new_steps := coalesce(cur.steps_done, '[]'::jsonb); new_skip := coalesce(cur.skipped, false);
  if p_done is true then
    if new_by is null then new_by := uid; new_ticked := current_date; end if;
    new_skip := false;
  elsif p_done is false and new_by is not null and (new_by = uid or is_owner) then new_by := null; new_ticked := null;
  end if;
  if p_skipped is not null then
    new_skip := p_skipped;
    if p_skipped and new_by is not null and (new_by = uid or is_owner) then new_by := null; new_ticked := null; end if;
  end if;
  if p_steps_done is not null then new_steps := p_steps_done; end if;
  if new_by is null and not new_skip and jsonb_array_length(new_steps) = 0 then
    delete from public.flat_chore_done d where d.chore_id = p_id and d.done_on = p_date;
  else
    insert into public.flat_chore_done (chore_id, flat_id, done_on, done_by, skipped, steps_done, ticked_on)
      values (p_id, fid, p_date, new_by, new_skip, new_steps, new_ticked)
      on conflict (chore_id, done_on) do update set done_by = excluded.done_by, skipped = excluded.skipped, steps_done = excluded.steps_done, ticked_on = excluded.ticked_on;
  end if;
end $$;

revoke all on function public.save_flat_chore(uuid, text, text, integer, date, integer, text, jsonb, jsonb), public.set_flat_chore_day(uuid, date, boolean, boolean, jsonb) from public, anon;
grant execute on function public.save_flat_chore(uuid, text, text, integer, date, integer, text, jsonb, jsonb), public.set_flat_chore_day(uuid, date, boolean, boolean, jsonb) to authenticated;
