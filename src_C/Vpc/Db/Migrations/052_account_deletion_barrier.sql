-- The sub is a minimal retained personal identifier. Keep the fence indefinitely until
-- an owner verifies identity deletion and token/callback expiry through a trusted channel.
-- No client claim or retention tick removes it. Runtime needs SELECT/INSERT only here;
-- migration ownership and trigger creation stay with the isolated migration role.
create table if not exists account_deletions (
  sub text primary key,
  requested_at timestamptz not null default now(),
  identity_status text not null default 'pending_owner_confirmation'
    check (identity_status in ('pending_owner_confirmation', 'confirmed')),
  identity_confirmed_at timestamptz null,
  check ((identity_status = 'confirmed') = (identity_confirmed_at is not null))
);

-- SECURITY DEFINER lets a DML-only runtime enforce the fence without granting it
-- access to the retained identifiers. Schema-qualify objects and pin search_path.
create or replace function public.enforce_account_deletion_barrier() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $barrier$
declare
  new_sub text := to_jsonb(new) ->> tg_argv[0];
  old_sub text;
  locked_sub text;
begin
  if tg_op = 'UPDATE' then old_sub := to_jsonb(old) ->> tg_argv[0]; end if;
  for locked_sub in
    select distinct s from unnest(array[new_sub, old_sub]) as subjects(s)
    where s is not null order by s
  loop
    -- Actual API writers use READ COMMITTED. A fixed transaction snapshot
    -- could otherwise miss a fence committed while waiting on this lock.
    if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
      raise exception using errcode = '40001', message = 'User writes require READ COMMITTED deletion fencing';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(locked_sub, 520052));
    -- This volatile trigger's query takes a fresh READ COMMITTED snapshot after
    -- waiting on the lock, including when the outer INSERT began before DELETE.
    if exists (select 1 from public.account_deletions where sub = locked_sub) then
      raise exception using errcode = '55000', message = 'ACCOUNT_DELETION_PENDING';
    end if;
  end loop;
  return new;
end
$barrier$;
revoke all on function public.enforce_account_deletion_barrier() from public;

do $install$
declare owned record;
begin
  for owned in select * from (values
    ('users', 'user_sub'), ('user_entitlements', 'user_sub'),
    ('user_subscriptions', 'user_sub'), ('user_progress_events', 'user_sub'),
    ('user_progress', 'user_sub'), ('user_draw_owned', 'user_sub'),
    ('user_draw_meta', 'user_sub'), ('user_wallet', 'user_sub'),
    ('user_deck_wallet', 'user_sub'), ('user_premium_state', 'app_user_id'),
    ('rc_webhook_events', 'app_user_id'), ('card_reports', 'user_sub')
  ) as t(table_name, sub_column)
  loop
    execute format('drop trigger if exists account_deletion_barrier on public.%I', owned.table_name);
    execute format('create trigger account_deletion_barrier before insert or update on public.%I for each row execute function public.enforce_account_deletion_barrier(%L)', owned.table_name, owned.sub_column);
  end loop;
end
$install$;

alter table revenuecat_deletions add column if not exists state text not null default 'pending'
  check (state in ('pending', 'needs_attention'));
update revenuecat_deletions set state = 'needs_attention'
where attempts >= 10 or requested_at < now() - interval '30 days';
