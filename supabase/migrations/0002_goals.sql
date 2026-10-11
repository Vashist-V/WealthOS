-- WealthOS: savings goals.
-- Adds one table. Safe to re-run. Nothing existing is changed.
--
-- A goal is a target amount by a date. What has been saved towards it is either
-- a figure the user types in (saved_amount) or the value of one of their
-- portfolios (portfolio_id). Like every other table, a row is visible only to
-- the account that owns it.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric(18, 2) not null check (target_amount > 0),
  target_date date not null,
  portfolio_id uuid references public.portfolios (id) on delete set null,
  saved_amount numeric(18, 2) not null default 0 check (saved_amount >= 0),
  monthly_amount numeric(18, 2) not null default 0 check (monthly_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id);
create index if not exists goals_portfolio_idx on public.goals (portfolio_id);

drop trigger if exists set_updated_at on public.goals;
create trigger set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

alter table public.goals enable row level security;
drop policy if exists goals_select_own on public.goals;
drop policy if exists goals_insert_own on public.goals;
drop policy if exists goals_update_own on public.goals;
drop policy if exists goals_delete_own on public.goals;

create policy goals_select_own on public.goals for select to authenticated
  using ((select auth.uid()) = user_id);
create policy goals_update_own on public.goals for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (portfolio_id is null
         or exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  );
create policy goals_delete_own on public.goals for delete to authenticated
  using ((select auth.uid()) = user_id);
-- On insert as on update, a goal may point at a portfolio only if that portfolio is the caller's own.
create policy goals_insert_own on public.goals for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (portfolio_id is null
         or exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  );

revoke all on public.goals from anon;
grant select, insert, update, delete on public.goals to authenticated;
grant all on public.goals to service_role;
