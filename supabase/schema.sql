-- ============================================================
-- Intelio — Supabase database schema
-- Run this in: Supabase dashboard > SQL Editor > New query
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── 1. clients ───────────────────────────────────────────────────────────────
-- One row per registered user. Maps 1:1 to SKILL.md runtime inputs.

create table if not exists clients (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references auth.users(id) on delete cascade, -- owning login account
  email                   text not null unique,
  client_name             text not null,
  client_contact          text,
  client_profile          text,                         -- free-text description of the company
  client_entities         text[]  default '{}',         -- business units / brands / people
  region                  text    default 'DACH',
  news_scope              text    default 'both',        -- 'regional' | 'global' | 'both'
  client_topics           text[]  default '{}',         -- custom topic chips
  client_local_sources    text,                         -- comma-separated local outlets
  client_priority_sources text[]  default '{}',
  client_source_blacklist text[]  default '{}',
  output_language         text    default 'en',          -- 'en' | 'de'
  sections_enabled        int[]   default '{1,2,3,4,5,6,7}',
  view_mode               text    default 'daily',       -- 'daily' | 'weekly'
  delivery_time           text    default '0700',        -- HHMM local time
  client_profile_refresh  text    default 'monthly',
  stories_per_section     int     default 3,
  lookback_hours          int     default 72,
  active                  boolean default true,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- Index for fast active-client lookups by the daily cron
create index if not exists idx_clients_active on clients(active);

-- ── 2. client_profiles ───────────────────────────────────────────────────────
-- Agent 00 monthly intelligence profile (markdown). Versioned by created_at.

create table if not exists client_profiles (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,  -- denormalised owner for fast RLS
  markdown    text not null,
  created_at  timestamptz default now()
);

-- Index: get latest profile per client efficiently
create index if not exists idx_profiles_client_date on client_profiles(client_id, created_at desc);

-- ── 3. briefings ─────────────────────────────────────────────────────────────
-- One row per daily/weekly briefing. HTML is the full self-contained page.

create table if not exists briefings (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,  -- denormalised owner for fast RLS
  date        date not null,                            -- briefing date (YYYY-MM-DD)
  html        text not null,                            -- full briefing HTML
  created_at  timestamptz default now(),
  unique(client_id, date)                               -- one briefing per client per day
);

-- Per-user ownership indexes (fast lookups at scale)
create index if not exists idx_clients_user_id         on clients(user_id);
create index if not exists idx_client_profiles_user_id on client_profiles(user_id);
create index if not exists idx_briefings_user_id       on briefings(user_id);

-- Index: get latest briefing per client
create index if not exists idx_briefings_client_date on briefings(client_id, date desc);

-- ── Row-Level Security (RLS) ─────────────────────────────────────────────────
-- Multi-tenant model: every row is owned by an auth.users account.
-- The backend pipeline uses the service-role key, which BYPASSES RLS, so cron /
-- signup / briefing generation are unaffected. These policies protect any
-- client-facing (anon / authenticated) access — e.g. a future user dashboard.

alter table clients         enable row level security;
alter table client_profiles enable row level security;
alter table briefings       enable row level security;

-- "Own rows only" — one policy per command, keyed on auth.uid().
-- clients
create policy clients_select_own on clients for select using (user_id = (select auth.uid()));
create policy clients_insert_own on clients for insert with check (user_id = (select auth.uid()));
create policy clients_update_own on clients for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy clients_delete_own on clients for delete using (user_id = (select auth.uid()));
-- client_profiles
create policy client_profiles_select_own on client_profiles for select using (user_id = (select auth.uid()));
create policy client_profiles_insert_own on client_profiles for insert with check (user_id = (select auth.uid()));
create policy client_profiles_update_own on client_profiles for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy client_profiles_delete_own on client_profiles for delete using (user_id = (select auth.uid()));
-- briefings
create policy briefings_select_own on briefings for select using (user_id = (select auth.uid()));
create policy briefings_insert_own on briefings for insert with check (user_id = (select auth.uid()));
create policy briefings_update_own on briefings for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy briefings_delete_own on briefings for delete using (user_id = (select auth.uid()));

-- ── Helper: auto-update updated_at on clients ────────────────────────────────
-- search_path pinned to '' to prevent search_path-injection (Supabase linter 0011).

create or replace function update_updated_at()
returns trigger language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_updated_at on clients;
create trigger clients_updated_at
  before update on clients
  for each row execute function update_updated_at();

-- ── Auth <-> client linking (both directions) ───────────────────────────────
-- The backend writes with the service-role key, so user_id must be stamped by
-- triggers for RLS-protected dashboard reads to work.

-- 1. Login created AFTER the client row (normal signup flow): link by email.
create or replace function link_client_to_user()
returns trigger language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.clients
     set user_id = new.id
   where lower(email) = lower(new.email)
     and user_id is null;

  update public.client_profiles cp
     set user_id = c.user_id
    from public.clients c
   where cp.client_id = c.id
     and cp.user_id is null
     and c.user_id is not null;

  update public.briefings b
     set user_id = c.user_id
    from public.clients c
   where b.client_id = c.id
     and b.user_id is null
     and c.user_id is not null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_client_to_user();

-- 2. Client row created (or email changed) AFTER the login already exists.
--    Without this, such rows keep user_id = null and the dashboard shows
--    "No briefing profile linked".
create or replace function adopt_user_for_client()
returns trigger language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null and new.email is not null then
    select u.id into new.user_id
      from auth.users u
     where lower(u.email) = lower(new.email)
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists adopt_user on clients;
create trigger adopt_user
  before insert or update of email on clients
  for each row execute function adopt_user_for_client();

-- 3. Stamp user_id on service-role-generated rows so they stay visible under RLS.
create or replace function set_row_owner_from_client()
returns trigger language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select user_id into new.user_id from public.clients where id = new.client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists set_owner on briefings;
create trigger set_owner
  before insert on briefings
  for each row execute function set_row_owner_from_client();

drop trigger if exists set_owner on client_profiles;
create trigger set_owner
  before insert on client_profiles
  for each row execute function set_row_owner_from_client();

-- ── One-time backfill (safe to re-run): link pre-existing rows ──────────────
update clients c
   set user_id = u.id
  from auth.users u
 where c.user_id is null
   and lower(c.email) = lower(u.email);

update briefings b
   set user_id = c.user_id
  from clients c
 where b.client_id = c.id
   and b.user_id is null
   and c.user_id is not null;

update client_profiles cp
   set user_id = c.user_id
  from clients c
 where cp.client_id = c.id
   and cp.user_id is null
   and c.user_id is not null;


-- ── Verification queries ─────────────────────────────────────────────────────
-- Run these after setup to confirm everything is correct:
--
-- select count(*) from clients;
-- select count(*) from client_profiles;
-- select count(*) from briefings;
