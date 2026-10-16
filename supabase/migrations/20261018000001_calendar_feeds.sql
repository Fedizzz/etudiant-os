-- Étudiant.OS — abonnement à un calendrier iCal (Celcat, iCloud, Google…).
-- Les navigateurs bloquent la lecture directe de ces liens (CORS) : la base télécharge le flux pour l'utilisateur
-- connecté, avec des garde-fous (https public uniquement, taille, délai, quota, contenu iCalendar obligatoire).
-- Le lien (qui contient souvent un jeton personnel) reste dans les données de l'utilisateur, protégées par RLS.

create extension if not exists http with schema extensions;

-- Réglages internes (aucun accès par l'API). En production : vide.
create table public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated, public;

create table public.calendar_fetch_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index calendar_fetch_log_user on public.calendar_fetch_log (user_id, at desc);
alter table public.calendar_fetch_log enable row level security;
revoke all on public.calendar_fetch_log from anon, authenticated, public;

create function public.fetch_calendar(p_url text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := public._require_active();
  url text := regexp_replace(btrim(coalesce(p_url, '')), '^webcals?://', 'https://', 'i');
  host text; port text; res record;
  allow_private boolean := false;
begin
  if char_length(url) > 2000 or url !~* '^https?://[^/\s]+(/\S*)?$' then raise exception 'lien de calendrier invalide' using errcode = '22023'; end if;
  host := lower(substring(url from '^[a-z]+://([^/:?#]+)'));
  port := substring(url from '^[a-z]+://[^/:?#]+:(\d+)');
  -- Tests automatisés locaux : un seul hôte de test autorisé, inscrit à la main dans app_config (jamais en production).
  allow_private := exists (select 1 from public.app_config c where c.key = 'calendar_test_host' and c.value = host);
  if not allow_private then
    if url !~* '^https://' then raise exception 'le lien doit commencer par https:// (ou webcal://)' using errcode = '22023'; end if;
    if port is not null and port not in ('443') then raise exception 'port non autorisé' using errcode = '22023'; end if;
    -- Pas d'adresses internes : IP privées / locales, noms locaux, métadonnées de serveurs.
    if host ~ '^\[' or host ~ '^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata.*)$'
       or host ~ '^(0|10|127)\.' or host ~ '^169\.254\.' or host ~ '^192\.168\.' or host ~ '^172\.(1[6-9]|2\d|3[01])\.'
       or host ~ '^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.' or host !~ '\.[a-z]{2,}$' then
      raise exception 'adresse non autorisée' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from public.calendar_fetch_log l where l.user_id = uid and l.at > now() - interval '1 hour') >= 40 then
    raise exception 'trop d''actualisations : réessayez dans une heure' using errcode = 'P0001';
  end if;
  insert into public.calendar_fetch_log (user_id) values (uid);
  perform set_config('http.timeout_msec', '12000', true);
  begin
    select * into res from extensions.http_get(url);
  exception when others then
    raise exception 'calendrier injoignable (vérifiez le lien)' using errcode = 'P0001';
  end;
  if res.status <> 200 then raise exception 'le serveur du calendrier a répondu %', res.status using errcode = 'P0001'; end if;
  if res.content is null or octet_length(res.content) > 4 * 1024 * 1024 then raise exception 'calendrier vide ou trop volumineux' using errcode = 'P0001'; end if;
  if position('BEGIN:VCALENDAR' in upper(left(res.content, 4000))) = 0 then raise exception 'ce lien ne renvoie pas un calendrier .ics' using errcode = 'P0001'; end if;
  return res.content;
end $$;
revoke all on function public.fetch_calendar(text) from public, anon;
grant execute on function public.fetch_calendar(text) to authenticated;

-- Le journal d'appels est purgé automatiquement (au-delà de 2 jours) à chaque appel… via un nettoyage léger :
create function public._purge_calendar_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.calendar_fetch_log where at < now() - interval '2 days';
  return null;
end $$;
create trigger calendar_fetch_log_purge after insert on public.calendar_fetch_log for each statement execute function public._purge_calendar_log();
revoke all on function public._purge_calendar_log() from public, anon, authenticated;
