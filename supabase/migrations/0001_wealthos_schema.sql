-- WealthOS / InvestDesk schema
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Ownership model: every user-owned row carries user_id and is guarded by
-- row-level security. The API talks to PostgREST with the signed-in user's
-- JWT, so these policies are the access boundary. Shared market reference
-- tables are readable by any signed-in user and writable only by the backend
-- (service role).

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------- profiles
-- The proposal's `users` table: app-level data for each auth user.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  base_currency text not null default 'INR',
  risk_free_rate numeric(6, 4) not null default 0.065,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------- portfolios
create table if not exists public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '',
  kind text not null default 'investment' check (kind in ('investment', 'paper')),
  color text not null default '#6E7BFF',
  benchmark text not null default '^NSEI',
  cash_balance numeric(18, 2) not null default 0 check (cash_balance >= 0),
  initial_capital numeric(18, 2) not null default 0 check (initial_capital >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portfolios_user_idx on public.portfolios (user_id);

-- ----------------------------------------------------------- transactions
-- The ledger. Positions are always derived from these rows.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  transaction_type text not null check (transaction_type in ('BUY', 'SELL', 'DIVIDEND')),
  quantity numeric(20, 6) not null check (quantity > 0),
  price numeric(18, 4) not null check (price >= 0),
  fees numeric(18, 2) not null default 0 check (fees >= 0),
  transaction_date date not null,
  notes text not null default '',
  source text not null default 'manual' check (source in ('manual', 'import', 'paper', 'sample')),
  created_at timestamptz not null default now()
);
create index if not exists transactions_portfolio_date_idx on public.transactions (portfolio_id, transaction_date);
create index if not exists transactions_user_idx on public.transactions (user_id);
create index if not exists transactions_symbol_idx on public.transactions (symbol);

-- --------------------------------------------------------------- holdings
-- Cached open positions, rewritten by the API whenever the ledger changes.
create table if not exists public.holdings (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  symbol text not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quantity numeric(20, 6) not null,
  avg_cost numeric(18, 4) not null,
  invested numeric(18, 2) not null,
  realized_pnl numeric(18, 2) not null default 0,
  first_buy_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (portfolio_id, symbol)
);
create index if not exists holdings_user_idx on public.holdings (user_id);

-- ---------------------------------------------------- portfolio_snapshots
create table if not exists public.portfolio_snapshots (
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  snapshot_date date not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  total_value numeric(18, 2) not null,
  invested numeric(18, 2) not null,
  cash numeric(18, 2) not null default 0,
  unrealized_pnl numeric(18, 2) not null default 0,
  realized_pnl numeric(18, 2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (portfolio_id, snapshot_date)
);
create index if not exists portfolio_snapshots_user_idx on public.portfolio_snapshots (user_id);

-- ------------------------------------------------------------- watchlists
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists watchlists_user_idx on public.watchlists (user_id);

create table if not exists public.watchlist_stocks (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (watchlist_id, symbol)
);
create index if not exists watchlist_stocks_user_idx on public.watchlist_stocks (user_id);

-- -------------------------------------------------------- journal_entries
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  portfolio_id uuid references public.portfolios (id) on delete set null,
  symbol text not null,
  action text not null default 'BUY' check (action in ('BUY', 'SELL', 'HOLD', 'WATCH')),
  entry_price numeric(18, 4),
  entry_date date not null default current_date,
  horizon text not null default '',
  thesis text not null default '',
  reasons text[] not null default '{}',
  exit_conditions text not null default '',
  conviction smallint not null default 3 check (conviction between 1 and 5),
  tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'closed')),
  outcome_notes text not null default '',
  closed_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journal_entries_user_idx on public.journal_entries (user_id);
create index if not exists journal_entries_portfolio_idx on public.journal_entries (portfolio_id);

-- ----------------------------------------------------------------- alerts
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null,
  alert_type text not null check (alert_type in ('price_above', 'price_below', 'pct_change', 'earnings', 'dividend')),
  threshold numeric(18, 4) not null,
  note text not null default '',
  is_active boolean not null default true,
  triggered_at timestamptz,
  last_value numeric(18, 4),
  created_at timestamptz not null default now()
);
create index if not exists alerts_user_idx on public.alerts (user_id);

-- --------------------------------------------------------------- backtest
create table if not exists public.backtest_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  config jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists backtest_strategies_user_idx on public.backtest_strategies (user_id);

create table if not exists public.backtest_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  strategy_id uuid references public.backtest_strategies (id) on delete cascade,
  strategy_name text not null default '',
  symbol text not null,
  start_date date not null,
  end_date date not null,
  initial_capital numeric(18, 2) not null,
  final_value numeric(18, 2) not null,
  cagr numeric(12, 6),
  max_drawdown numeric(12, 6),
  total_trades integer not null default 0,
  stats jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists backtest_results_user_idx on public.backtest_results (user_id);
create index if not exists backtest_results_strategy_idx on public.backtest_results (strategy_id);

-- ------------------------------------------------------- portfolio_shares
-- A row is a read-only public link to one portfolio's structure.
create table if not exists public.portfolio_shares (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  show_values boolean not null default false,
  created_at timestamptz not null default now(),
  unique (portfolio_id)
);
create index if not exists portfolio_shares_user_idx on public.portfolio_shares (user_id);

-- ------------------------------------------------- shared market reference
create table if not exists public.price_history (
  symbol text not null,
  trade_date date not null,
  open numeric(18, 4),
  high numeric(18, 4),
  low numeric(18, 4),
  close numeric(18, 4) not null,
  volume numeric(20, 0) not null default 0,
  primary key (symbol, trade_date)
);

create table if not exists public.dividends (
  symbol text not null,
  ex_date date not null,
  amount numeric(18, 4) not null,
  primary key (symbol, ex_date)
);

create table if not exists public.corporate_actions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  action_type text not null check (action_type in ('dividend', 'split', 'bonus', 'results', 'board_meeting', 'other')),
  action_date date not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (symbol, action_type, action_date)
);
create index if not exists corporate_actions_date_idx on public.corporate_actions (action_date);

-- --------------------------------------------------------------- triggers
do $$
declare t text;
begin
  foreach t in array array['profiles', 'portfolios', 'holdings', 'journal_entries', 'backtest_strategies'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ----------------------------------------------------- row-level security
-- Tables owned directly through user_id.
do $$
declare t text;
begin
  foreach t in array array[
    'portfolios', 'transactions', 'holdings', 'portfolio_snapshots', 'watchlists', 'watchlist_stocks',
    'journal_entries', 'alerts', 'backtest_strategies', 'backtest_results', 'portfolio_shares'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)', t || '_delete_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

-- Inserts: the row must be the caller's, and any parent it hangs off must be too.
do $$
declare t text;
begin
  foreach t in array array['portfolios', 'watchlists', 'alerts', 'backtest_strategies', 'backtest_results'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)', t || '_insert_own', t);
  end loop;

  foreach t in array array['transactions', 'holdings', 'portfolio_snapshots', 'portfolio_shares'] loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id and exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))',
      t || '_insert_own', t);
  end loop;
end;
$$;

create policy watchlist_stocks_insert_own on public.watchlist_stocks for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = (select auth.uid()))
  );

create policy journal_entries_insert_own on public.journal_entries for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (portfolio_id is null
         or exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  );

-- Profiles: a user reads and edits only their own row; rows are created by the trigger.
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke all on public.profiles from anon;
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Market reference data: read-only for signed-in users, written by the backend.
do $$
declare t text;
begin
  foreach t in array array['price_history', 'dividends', 'corporate_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;
