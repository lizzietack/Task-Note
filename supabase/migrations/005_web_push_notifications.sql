-- JotRelay v1.9: background Web Push and server-scheduled reminders.
-- Apply after 004_collaboration_controls.sql.

-- pg_net makes delivery immediate; pg_cron provides reminder scheduling and retries.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

begin;

alter table public.notification_preferences
  add column if not exists push_notifications boolean not null default false;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_own_select" on public.push_subscriptions;
create policy "push_subscriptions_own_select" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_insert" on public.push_subscriptions;
create policy "push_subscriptions_own_insert" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_update" on public.push_subscriptions;
create policy "push_subscriptions_own_update" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;
create policy "push_subscriptions_own_delete" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table if not exists public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  response_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id, subscription_id)
);

create index if not exists push_notification_deliveries_pending_idx
  on public.push_notification_deliveries(status, available_at);
alter table public.push_notification_deliveries enable row level security;
revoke all on public.push_notification_deliveries from anon, authenticated;

create or replace function public.daymark_queue_push_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.notification_preferences p
    where p.user_id = new.user_id and p.push_notifications
  ) then
    insert into public.push_notification_deliveries(notification_id, subscription_id)
    select new.id, s.id
    from public.push_subscriptions s
    where s.user_id = new.user_id
    on conflict (notification_id, subscription_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists daymark_notifications_push_queue on public.notifications;
create trigger daymark_notifications_push_queue
after insert on public.notifications
for each row execute function public.daymark_queue_push_delivery();

create or replace function public.daymark_claim_push_deliveries(
  worker_secret text,
  batch_limit integer default 50
)
returns table(
  delivery_id uuid,
  subscription_id uuid,
  notification_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.daymark_delivery_secret_valid(worker_secret) then raise exception 'Unauthorized worker'; end if;
  return query
  with candidates as (
    select d.id
    from public.push_notification_deliveries d
    where (d.status = 'pending' and d.available_at <= now())
       or (d.status = 'processing' and d.updated_at < now() - interval '10 minutes')
    order by d.created_at
    limit greatest(1, least(batch_limit, 100))
    for update skip locked
  ), claimed as (
    update public.push_notification_deliveries d
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    from candidates c
    where d.id = c.id
    returning d.id, d.subscription_id, d.notification_id
  )
  select c.id, s.id, n.id, s.endpoint, s.p256dh, s.auth, n.title, coalesce(n.message, n.title)
  from claimed c
  join public.push_subscriptions s on s.id = c.subscription_id
  join public.notifications n on n.id = c.notification_id;
end;
$$;

create or replace function public.daymark_finish_push_delivery(
  worker_secret text,
  target_delivery uuid,
  delivered boolean,
  response_code integer default null,
  failure_message text default null,
  subscription_expired boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_subscription uuid;
begin
  if not public.daymark_delivery_secret_valid(worker_secret) then raise exception 'Unauthorized worker'; end if;
  select d.subscription_id into target_subscription
  from public.push_notification_deliveries d
  where d.id = target_delivery and d.status = 'processing'
  for update;
  if target_subscription is null then return; end if;

  update public.push_notification_deliveries
  set status = case when delivered then 'sent' when subscription_expired or attempts >= 5 then 'failed' else 'pending' end,
      response_status = response_code,
      last_error = left(failure_message, 500),
      available_at = case when delivered or subscription_expired then available_at else now() + (interval '1 minute' * greatest(1, attempts * attempts)) end,
      updated_at = now()
  where id = target_delivery;

  if delivered then
    update public.push_subscriptions set last_success_at = now(), updated_at = now()
    where id = target_subscription;
  elsif subscription_expired then
    delete from public.push_subscriptions where id = target_subscription;
  end if;
end;
$$;

revoke all on function public.daymark_claim_push_deliveries(text, integer) from public;
revoke all on function public.daymark_finish_push_delivery(text, uuid, boolean, integer, text, boolean) from public;
grant execute on function public.daymark_claim_push_deliveries(text, integer) to anon;
grant execute on function public.daymark_finish_push_delivery(text, uuid, boolean, integer, text, boolean) to anon;

-- Queue reminders on the server so a suspended phone does not have to run a timer.
-- Persistent reminders receive a new delivery slot every 15 minutes for 24 hours.
create or replace function public.daymark_queue_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  with due as (
    select t.user_id, t.id, t.title, t.reminder,
      ((t.date + coalesce(t.time, time '09:00')) at time zone tz.name)
      - case t.reminder
          when '10 minutes before' then interval '10 minutes'
          when '30 minutes before' then interval '30 minutes'
          when '1 hour before' then interval '1 hour'
          when '1 day before' then interval '1 day'
          else interval '0 minutes'
        end as notify_at
    from public.tasks t
    join public.profiles p on p.id = t.user_id
    join pg_timezone_names tz on tz.name = coalesce(nullif(p.timezone, ''), 'UTC')
    where not t.completed and t.date is not null and t.reminder <> 'None'
  )
  insert into public.notifications(user_id, actor_id, type, title, message, task_id, dedupe_key)
  select d.user_id, d.user_id, 'task_reminder', 'Task reminder', d.title, d.id,
    'reminder:' || d.id || ':' || extract(epoch from d.notify_at)::bigint::text || ':' ||
    case when d.reminder = 'Keep reminding until completed'
      then greatest(0, floor(extract(epoch from (now() - d.notify_at)) / 900)::bigint)::text
      else '0'
    end
  from due d
  where d.notify_at <= now() and d.notify_at > now() - interval '1 day'
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.daymark_invoke_delivery_worker()
returns bigint
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  project_url text;
  worker_secret text;
  request_id bigint;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'daymark_project_url' limit 1;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name = 'daymark_notification_worker_secret' limit 1;
  if project_url is null or worker_secret is null then return null; end if;
  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/daymark-deliver-notifications',
    headers := jsonb_build_object('content-type', 'application/json', 'x-daymark-delivery-secret', worker_secret),
    body := '{}'::jsonb
  ) into request_id;
  return request_id;
exception when others then
  return null;
end;
$$;

create or replace function public.daymark_kick_delivery_worker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.daymark_invoke_delivery_worker();
  return new;
end;
$$;

drop trigger if exists daymark_push_delivery_kick on public.push_notification_deliveries;
create trigger daymark_push_delivery_kick
after insert on public.push_notification_deliveries
for each row execute function public.daymark_kick_delivery_worker();

drop trigger if exists daymark_email_delivery_kick on public.notification_deliveries;
create trigger daymark_email_delivery_kick
after insert on public.notification_deliveries
for each row execute function public.daymark_kick_delivery_worker();

revoke all on function public.daymark_invoke_delivery_worker() from public;
grant execute on function public.daymark_invoke_delivery_worker() to postgres;

do $$
declare job record;
begin
  for job in select jobid from cron.job where jobname in ('daymark-queue-due-reminders', 'daymark-deliver-pending-notifications') loop
    perform cron.unschedule(job.jobid);
  end loop;
  perform cron.schedule('daymark-queue-due-reminders', '* * * * *', 'select public.daymark_queue_due_reminders();');
  perform cron.schedule('daymark-deliver-pending-notifications', '* * * * *', 'select public.daymark_invoke_delivery_worker();');
end $$;

commit;
