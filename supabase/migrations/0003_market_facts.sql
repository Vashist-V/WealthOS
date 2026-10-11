-- WealthOS: company facts shared between servers.
--
-- Key figures, financial statements and results/dividend dates for the
-- companies the app tracks, as last fetched by a server that could reach the
-- source. A server that cannot (most hosting providers' addresses are refused)
-- starts from these rows. One row per company and kind.
--
-- This is market reference data and holds nothing of any user's, so anyone
-- with the project's public key may read it. Only the backend's service role
-- writes it. Safe to re-run.

create table if not exists public.market_facts (
  symbol text not null,
  kind text not null check (kind in ('info', 'financials', 'calendar')),
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, kind)
);

alter table public.market_facts enable row level security;

drop policy if exists market_facts_read on public.market_facts;
create policy market_facts_read on public.market_facts for select to anon, authenticated using (true);

revoke all on public.market_facts from anon, authenticated;
grant select on public.market_facts to anon, authenticated;
grant all on public.market_facts to service_role;
