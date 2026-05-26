create table if not exists public.valuation_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
  zpid text,
  zestimate numeric,
  cma_mid numeric,
  score integer,
  report jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.valuation_reports enable row level security;

create policy "Users can read own valuation reports"
  on public.valuation_reports
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create own valuation reports"
  on public.valuation_reports
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete own valuation reports"
  on public.valuation_reports
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.property_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  normalized_address text not null unique,
  address text not null,
  zpid text,
  report jsonb not null,
  zillow_raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.property_analysis_cache enable row level security;

create policy "Authenticated users can read cached property analysis"
  on public.property_analysis_cache
  for select
  to authenticated
  using (true);
