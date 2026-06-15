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
  sections_enabled        int[]   default '{1,2,3,4,5,6}',
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


-- ── Verification queries ─────────────────────────────────────────────────────
-- Run these after setup to confirm everything is correct:
--
-- select count(*) from clients;
-- select count(*) from client_profiles;
-- select count(*) from briefings;
