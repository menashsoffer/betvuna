-- נבחרת השגרירים: סכמה, הרשאות, פונקציות ו-Realtime
-- anon אינו ניגש לטבלאות כלל. הכל עובר דרך פונקציות security definer.

create extension if not exists pgcrypto with schema extensions;

-- ---------- טבלאות ----------

create table public.participants (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null check (char_length(btrim(full_name)) between 2 and 60),
  phone         text not null unique check (phone ~ '^\+9725[0-9]{8}$'),
  email         text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 120),
  city          text not null check (char_length(btrim(city)) between 2 and 40),
  photo_path    text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}\.jpg$'),
  photo_hidden  boolean not null default false,
  wall_hidden   boolean not null default false,
  consent_at    timestamptz not null,
  token_hash    text not null,
  registered_by uuid references public.participants(id) on delete set null,
  joined_at     timestamptz,
  join_seq      integer unique,
  is_simulated  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index participants_token_hash_idx on public.participants (token_hash);
create index participants_registered_by_idx on public.participants (registered_by);

create table public.settings (
  id         boolean primary key default true check (id),
  join_open  boolean not null default true,
  wall_epoch integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

create table public.admin_emails (
  email text primary key check (email = lower(email))
);

create table public.rate_events (
  id  bigint generated always as identity primary key,
  key text not null,
  at  timestamptz not null default now()
);
create index rate_events_key_at_idx on public.rate_events (key, at);

alter table public.participants enable row level security;
alter table public.settings     enable row level security;
alter table public.admin_emails enable row level security;
alter table public.rate_events  enable row level security;

revoke all on public.participants, public.settings, public.admin_emails, public.rate_events from anon, authenticated;

-- ---------- עזרים ----------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.admin_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if d like '972%' then d := substr(d, 4); end if;
  if d like '0%'   then d := substr(d, 2); end if;
  if d !~ '^5[0-9]{8}$' then raise exception 'invalid_phone' using errcode = '22023'; end if;
  return '+972' || d;
end $$;

create or replace function public.hash_token(t text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(t, 'sha256'), 'hex');
$$;

create or replace function public.new_token() returns text
language sql volatile set search_path = '' as $$
  select encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function public.rate_limit(k text, max_per_min int default 10) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.rate_events where at < now() - interval '10 minutes';
  if (select count(*) from public.rate_events where key = k and at > now() - interval '1 minute') >= max_per_min then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.rate_events (key) values (k);
end $$;

create or replace function public.photo_url(path text) returns text
language sql stable set search_path = '' as $$
  select case when path is null then null else 'photos/' || path end;
$$;

-- ---------- View למסך ----------

create or replace view public.wall_entries with (security_invoker = true) as
  select join_seq, full_name, city,
         case when photo_hidden then null else public.photo_url(photo_path) end as photo,
         joined_at, is_simulated
  from public.participants
  where join_seq is not null and not wall_hidden;
revoke all on public.wall_entries from anon, authenticated;

-- ---------- פונקציות ציבוריות ----------

create or replace function public.register(
  p_name text, p_phone text, p_email text, p_city text, p_consent boolean,
  p_photo_path text default null, p_registered_by_token text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_token text := public.new_token();
  v_by uuid;
  v_id uuid;
begin
  if not coalesce(p_consent, false) then raise exception 'consent_required' using errcode = '22023'; end if;
  perform public.rate_limit('register:' || v_phone);
  if p_registered_by_token is not null then
    select id into v_by from public.participants where token_hash = public.hash_token(p_registered_by_token);
  end if;
  insert into public.participants (full_name, phone, email, city, photo_path, consent_at, token_hash, registered_by)
  values (btrim(p_name), v_phone, lower(btrim(p_email)), btrim(p_city), p_photo_path, now(), public.hash_token(v_token), v_by)
  on conflict (phone) do update set
    full_name  = excluded.full_name,
    email      = excluded.email,
    city       = excluded.city,
    photo_path = coalesce(excluded.photo_path, public.participants.photo_path),
    consent_at = excluded.consent_at,
    token_hash = excluded.token_hash,
    updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.set_photo(p_token text, p_photo_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.participants set photo_path = p_photo_path, photo_hidden = false, updated_at = now()
  where token_hash = public.hash_token(p_token);
  if not found then raise exception 'unknown_token' using errcode = 'P0002'; end if;
end $$;

create or replace function public.join_wall(p_token text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_seq integer;
begin
  select id, join_seq into v_id, v_seq from public.participants
  where token_hash = public.hash_token(p_token) for update;
  if v_id is null then raise exception 'unknown_token' using errcode = 'P0002'; end if;
  if v_seq is not null then return v_seq; end if;
  if not (select join_open from public.settings) then raise exception 'join_closed' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(424242);
  select coalesce(max(join_seq), 0) + 1 into v_seq from public.participants;
  update public.participants set joined_at = now(), join_seq = v_seq, updated_at = now() where id = v_id;
  return v_seq;
end $$;

create or replace function public.recover(p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_phone text := public.normalize_phone(p_phone); v_token text := public.new_token(); v_id uuid;
begin
  perform public.rate_limit('recover:' || v_phone);
  update public.participants set token_hash = public.hash_token(v_token), updated_at = now()
  where phone = v_phone and not is_simulated returning id into v_id;
  if v_id is null then return null; end if;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.me(p_tokens text[]) returns table (
  id uuid, full_name text, city text, photo text, joined boolean, join_seq integer
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.city, public.photo_url(p.photo_path), p.join_seq is not null, p.join_seq
  from public.participants p
  where p.token_hash = any (select public.hash_token(t) from unnest(p_tokens[1:20]) t);
$$;

create or replace function public.wall_since(p_seq integer default 0) returns setof public.wall_entries
language sql stable security definer set search_path = '' as $$
  select * from public.wall_entries where join_seq > coalesce(p_seq, 0) order by join_seq;
$$;

create or replace function public.wall_state() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('join_open', join_open, 'wall_epoch', wall_epoch) from public.settings;
$$;

-- ---------- פונקציות אדמין ----------

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
end $$;

create or replace function public.admin_join(p_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_seq integer;
begin
  perform public.assert_admin();
  select join_seq into v_seq from public.participants where id = p_id for update;
  if v_seq is not null then return v_seq; end if;
  perform pg_advisory_xact_lock(424242);
  select coalesce(max(join_seq), 0) + 1 into v_seq from public.participants;
  update public.participants set joined_at = now(), join_seq = v_seq, updated_at = now() where id = p_id;
  return v_seq;
end $$;

create or replace function public.admin_reset_wall() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  delete from public.participants where is_simulated;
  update public.participants set joined_at = null, join_seq = null, updated_at = now() where join_seq is not null;
  update public.settings set wall_epoch = wall_epoch + 1, updated_at = now();
end $$;

create or replace function public.admin_simulate(p_count integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  names  text[] := array['אברהם כהן','יצחק לוי','יעקב מזרחי','משה פרץ','אהרן ביטון','דוד אברהם','שלמה פרידמן','יוסף דהן','בנימין אזולאי','שמואל גבאי'];
  cities text[] := array['ירושלים','בני ברק','אלעד','בית שמש','מודיעין עילית','ביתר עילית','צפת','אשדוד','נתיבות','חיפה','פתח תקווה','רחובות'];
  i int; v_seq int;
begin
  perform public.assert_admin();
  if p_count not between 1 and 150 then raise exception 'bad_count' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(424242);
  for i in 1..p_count loop
    select coalesce(max(join_seq), 0) + 1 into v_seq from public.participants;
    insert into public.participants (full_name, phone, email, city, consent_at, token_hash, is_simulated, joined_at, join_seq)
    values (names[1 + (random() * 9)::int], '+9725' || lpad((floor(random() * 1e8))::bigint::text, 8, '0'),
            'sim@example.com', cities[1 + (random() * 11)::int], now(), public.new_token(), true, now(), v_seq)
    on conflict (phone) do nothing;
  end loop;
  return p_count;
end $$;

create or replace function public.admin_set_join_open(p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_admin();
  update public.settings set join_open = p_open, updated_at = now();
end $$;

-- אדמין קורא וכותב ישירות לטבלת המשתתפים
grant select, update, delete on public.participants to authenticated;
create policy admin_all on public.participants for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select on public.settings to authenticated;
create policy admin_read on public.settings for select to authenticated using ((select public.is_admin()));

-- ---------- הרשאות הרצה ----------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.register(text, text, text, text, boolean, text, text),
  public.set_photo(text, text),
  public.join_wall(text),
  public.recover(text),
  public.me(text[]),
  public.wall_since(integer),
  public.wall_state()
  to anon, authenticated;
grant execute on function
  public.is_admin(),
  public.admin_join(uuid),
  public.admin_reset_wall(),
  public.admin_simulate(integer),
  public.admin_set_join_open(boolean)
  to authenticated;
-- RLS policy evaluation needs is_admin for authenticated; helpers used inside definer functions need no grant.

-- ---------- Realtime: broadcast לערוץ wall ----------

create or replace function public.broadcast_participant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.join_seq is not null then
      perform realtime.send(jsonb_build_object('join_seq', old.join_seq, 'removed', true), 'entry', 'wall', false);
    end if;
    return old;
  end if;
  if new.join_seq is null then return new; end if;
  perform realtime.send(
    jsonb_build_object(
      'join_seq', new.join_seq,
      'full_name', new.full_name,
      'city', new.city,
      'photo', case when new.photo_hidden then null else public.photo_url(new.photo_path) end,
      'joined_at', new.joined_at,
      'is_simulated', new.is_simulated,
      'removed', new.wall_hidden
    ), 'entry', 'wall', false);
  return new;
end $$;

create trigger participants_broadcast
  after insert or update or delete on public.participants
  for each row execute function public.broadcast_participant();

create or replace function public.broadcast_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.wall_epoch <> old.wall_epoch then
    perform realtime.send(jsonb_build_object('wall_epoch', new.wall_epoch), 'reset', 'wall', false);
  end if;
  perform realtime.send(jsonb_build_object('join_open', new.join_open, 'wall_epoch', new.wall_epoch), 'settings', 'wall', false);
  return new;
end $$;

create trigger settings_broadcast
  after update on public.settings
  for each row execute function public.broadcast_settings();

-- ---------- Storage ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 307200, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 307200, allowed_mime_types = array['image/jpeg'];

create policy photos_anon_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and name ~ '^[0-9a-f-]{36}\.jpg$');
create policy photos_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select public.is_admin()));
create policy photos_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select public.is_admin()));
