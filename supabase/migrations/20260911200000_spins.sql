-- Jonbet Double Analyzer — spins history
-- Run in Supabase SQL editor or via `supabase db push`

create table if not exists public.spins (
  id bigint generated always as identity primary key,
  round_id text not null unique,
  color text not null check (color in ('green', 'black', 'white')),
  number integer not null check (number >= 0 and number <= 14),
  rolled_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text,
  source_url text
);

create index if not exists spins_rolled_at_idx on public.spins (rolled_at desc);
create index if not exists spins_color_idx on public.spins (color);

alter table public.spins enable row level security;

drop policy if exists "spins_select_anon" on public.spins;
create policy "spins_select_anon"
  on public.spins for select
  to anon, authenticated
  using (true);

comment on table public.spins is 'Histórico Double Jonbet para análise 24/7';
