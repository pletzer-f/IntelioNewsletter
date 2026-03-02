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
  date        date not null,                            -- briefing date (YYYY-MM-DD)
  html        text not null,                            -- full briefing HTML
  created_at  timestamptz default now(),
  unique(client_id, date)                               -- one briefing per client per day
);

-- Index: get latest briefing per client
create index if not exists idx_briefings_client_date on briefings(client_id, date desc);

-- ── Row-Level Security (RLS) ─────────────────────────────────────────────────
-- These tables are only accessed by the server-side service role key,
-- so RLS is disabled. Enable if you add a client-facing dashboard later.

alter table clients         disable row level security;
alter table client_profiles disable row level security;
alter table briefings       disable row level security;

-- ── Helper: auto-update updated_at on clients ────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
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
