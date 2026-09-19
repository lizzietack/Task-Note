-- Daymark v1.7: reliable collaboration, activity history and notification delivery
-- Run after the existing collaboration schema and migrations 001/002.
-- The browser continues to use only the Supabase publishable key.

begin;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists timezone text;

alter table public.task_comments
  add column if not exists client_nonce uuid;

create unique index if not exists task_comments_author_nonce_idx
  on public.task_comments(author_id, client_nonce);

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_user_dedupe_idx
  on public.notifications(user_id, dedupe_key);

-- The original table used the automatically named notifications_type_check.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in (
    'contact_invite', 'contact_accepted', 'contact_declined', 'task_assigned',
    'task_accepted', 'task_declined', 'task_completed',
    'assignment_accepted', 'assignment_declined', 'assignment_completed',
    'assignment_cancelled', 'comment_added',
    'task_comment', 'task_updated', 'task_reminder'
  )
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  contact_updates boolean not null default true,
  assignment_updates boolean not null default true,
  comment_updates boolean not null default true,
  task_reminders boolean not null default true,
  browser_notifications boolean not null default true,
  email_notifications boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
drop policy if exists "notification_preferences_own_select" on public.notification_preferences;
create policy "notification_preferences_own_select" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notification_preferences_own_insert" on public.notification_preferences;
create policy "notification_preferences_own_insert" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "notification_preferences_own_update" on public.notification_preferences;
create policy "notification_preferences_own_update" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notification_preferences to authenticated;

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  assignment_id uuid references public.task_assignments(id) on delete set null,
  event_type text not null check (event_type in (
    'assigned', 'accepted', 'declined', 'completed', 'cancelled',
    'commented', 'task_updated', 'owner_completed'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_activity_task_fk foreign key (owner_id, task_id)
    references public.tasks(user_id, id) on delete cascade
);

create index if not exists task_activity_task_created_idx
  on public.task_activity(task_id, created_at desc);

alter table public.task_activity enable row level security;
drop policy if exists "task_activity_participants_read" on public.task_activity;
create policy "task_activity_participants_read" on public.task_activity
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.task_assignments a
      where a.task_id = task_activity.task_id
        and a.owner_id = task_activity.owner_id
        and a.assignee_id = auth.uid()
        and a.status in ('pending', 'accepted', 'completed')
    )
  );
grant select on public.task_activity to authenticated;

-- Clients cannot read this queue. A constrained worker RPC claims and finishes jobs.
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  recipient_email text not null,
  title text not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries(status, available_at);
alter table public.notification_deliveries enable row level security;

create or replace function public.daymark_notification_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pref public.notification_preferences%rowtype;
begin
  select * into pref from public.notification_preferences where user_id = new.user_id;
  if not found then return new; end if;

  if new.type in ('contact_invite', 'contact_accepted', 'contact_declined') and not pref.contact_updates then return null; end if;
  if new.type in (
    'task_assigned', 'task_accepted', 'task_declined', 'task_completed',
    'assignment_accepted', 'assignment_declined', 'assignment_completed',
    'assignment_cancelled', 'task_updated'
  ) and not pref.assignment_updates then return null; end if;
  if new.type in ('comment_added', 'task_comment') and not pref.comment_updates then return null; end if;
  if new.type = 'task_reminder' and not pref.task_reminders then return null; end if;
  return new;
end;
$$;

drop trigger if exists daymark_notifications_preference_gate on public.notifications;
create trigger daymark_notifications_preference_gate
before insert on public.notifications
for each row execute function public.daymark_notification_allowed();

create or replace function public.daymark_queue_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient text;
  enabled boolean := false;
begin
  select p.email, coalesce(np.email_notifications, false)
    into recipient, enabled
  from public.profiles p
  left join public.notification_preferences np on np.user_id = p.id
  where p.id = new.user_id;

  if enabled and recipient is not null and length(trim(recipient)) > 3 then
    insert into public.notification_deliveries(notification_id, recipient_email, title, message)
    values (new.id, lower(trim(recipient)), new.title, coalesce(new.message, new.title))
    on conflict (notification_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists daymark_notifications_email_queue on public.notifications;
create trigger daymark_notifications_email_queue
after insert on public.notifications
for each row execute function public.daymark_queue_email_delivery();

create or replace function public.daymark_log_assignment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
  actor uuid;
begin
  if tg_op = 'INSERT' then
    event_name := 'assigned'; actor := new.owner_id;
  elsif old.status is not distinct from new.status then
    return new;
  else
    event_name := case new.status
      when 'accepted' then 'accepted'
      when 'declined' then 'declined'
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      else null end;
    actor := case when new.status = 'cancelled' then new.owner_id else new.assignee_id end;
  end if;
  if event_name is not null then
    insert into public.task_activity(task_id, owner_id, actor_id, assignment_id, event_type)
    values (new.task_id, new.owner_id, actor, new.id, event_name);
  end if;
  return new;
end;
$$;

drop trigger if exists daymark_assignment_activity on public.task_assignments;
create trigger daymark_assignment_activity
after insert or update of status on public.task_assignments
for each row execute function public.daymark_log_assignment_activity();

-- Give assignments created before v1.7 a useful starting history. Re-running the
-- migration does not duplicate these baseline events.
insert into public.task_activity(task_id, owner_id, actor_id, assignment_id, event_type, created_at)
select a.task_id, a.owner_id, a.owner_id, a.id, 'assigned', a.assigned_at
from public.task_assignments a
where not exists (
  select 1 from public.task_activity h
  where h.assignment_id = a.id and h.event_type = 'assigned'
);

insert into public.task_activity(task_id, owner_id, actor_id, assignment_id, event_type, created_at)
select a.task_id, a.owner_id,
  case when a.status = 'cancelled' then a.owner_id else a.assignee_id end,
  a.id, a.status,
  case when a.status = 'completed' then coalesce(a.completed_at, a.updated_at)
       else coalesce(a.responded_at, a.updated_at) end
from public.task_assignments a
where a.status in ('accepted', 'declined', 'completed', 'cancelled')
  and not exists (
    select 1 from public.task_activity h
    where h.assignment_id = a.id and h.event_type = a.status
  );

create or replace function public.daymark_log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
  task_title text;
  actor_name text;
  recipient uuid;
begin
  select a.owner_id into owner
  from public.task_assignments a
  where a.task_id = new.task_id
  order by a.assigned_at
  limit 1;
  if owner is null then return new; end if;

  insert into public.task_activity(task_id, owner_id, actor_id, event_type)
  values (new.task_id, owner, new.author_id, 'commented');

  select t.title into task_title from public.tasks t where t.user_id = owner and t.id = new.task_id;
  select coalesce(nullif(trim(p.display_name), ''), p.email, 'A Daymark user')
    into actor_name from public.profiles p where p.id = new.author_id;

  for recipient in
    select owner where owner <> new.author_id
    union
    select a.assignee_id from public.task_assignments a
      where a.task_id = new.task_id
        and a.status in ('accepted', 'completed')
        and a.assignee_id <> new.author_id
  loop
    insert into public.notifications(user_id, actor_id, type, title, message, task_id)
    values (recipient, new.author_id, 'task_comment', 'New task comment',
      actor_name || ' commented on ' || coalesce(task_title, 'a shared task') || '.', new.task_id);
  end loop;
  return new;
end;
$$;

drop trigger if exists daymark_comment_activity on public.task_comments;
create trigger daymark_comment_activity
after insert on public.task_comments
for each row execute function public.daymark_log_comment_activity();

create or replace function public.daymark_log_shared_task_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  event_name text := case when new.completed and not old.completed then 'owner_completed' else 'task_updated' end;
begin
  if row(old.title, old.completed, old.date, old.time, old.priority, old.category, old.note, old.subtasks)
     is not distinct from
     row(new.title, new.completed, new.date, new.time, new.priority, new.category, new.note, new.subtasks) then
    return new;
  end if;
  if not exists (select 1 from public.task_assignments a where a.task_id = new.id and a.owner_id = new.user_id) then
    return new;
  end if;

  insert into public.task_activity(task_id, owner_id, actor_id, event_type)
  values (new.id, new.user_id, new.user_id, event_name);

  for recipient in
    select distinct a.assignee_id from public.task_assignments a
    where a.task_id = new.id and a.owner_id = new.user_id and a.status in ('pending', 'accepted')
  loop
    insert into public.notifications(user_id, actor_id, type, title, message, task_id)
    values (recipient, new.user_id, 'task_updated',
      case when event_name = 'owner_completed' then 'Task completed by owner' else 'Assigned task updated' end,
      new.title, new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists daymark_shared_task_activity on public.tasks;
create trigger daymark_shared_task_activity
after update on public.tasks
for each row execute function public.daymark_log_shared_task_update();

create or replace function public.daymark_add_task_comment(
  target_task text,
  comment_body text,
  request_nonce uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  text_body text := trim(comment_body);
  existing_id uuid;
  created_id uuid;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if request_nonce is null then raise exception 'A request identifier is required'; end if;
  if length(text_body) < 1 or length(text_body) > 2000 then
    raise exception 'Comments must contain 1–2,000 characters.';
  end if;
  select c.id into existing_id from public.task_comments c
    where c.author_id = me and c.client_nonce = request_nonce;
  if existing_id is not null then return existing_id; end if;

  if not exists (
    select 1 from public.tasks t where t.id = target_task and t.user_id = me
    union all
    select 1 from public.task_assignments a
      where a.task_id = target_task and a.assignee_id = me and a.status in ('accepted', 'completed')
  ) then
    raise exception 'You cannot comment on this task';
  end if;

  insert into public.task_comments(task_id, author_id, body, client_nonce)
  values (target_task, me, text_body, request_nonce)
  returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.daymark_set_assignment_status(
  target_assignment uuid,
  target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if target_status not in ('accepted', 'declined', 'completed') then raise exception 'Invalid response'; end if;
  select a.status into current_status from public.task_assignments a
    where a.id = target_assignment and a.assignee_id = me for update;
  if current_status is null then raise exception 'Assignment not found'; end if;
  if current_status = target_status then
    return jsonb_build_object('status', current_status, 'replayed', true);
  end if;
  if target_status in ('accepted', 'declined') and current_status = 'pending' then
    perform public.daymark_respond_assignment(target_assignment, target_status);
  elsif target_status = 'completed' and current_status = 'accepted' then
    perform public.daymark_complete_assignment(target_assignment);
  else
    raise exception 'This action is no longer available';
  end if;
  return jsonb_build_object('status', target_status, 'replayed', false);
end;
$$;

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
    select t.user_id, t.id, t.title,
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
    'reminder:' || d.id || ':' || extract(epoch from d.notify_at)::bigint::text
  from due d
  where d.notify_at <= now() and d.notify_at > now() - interval '1 day'
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- The delivery worker authenticates with a random secret stored in Supabase Vault.
create or replace function public.daymark_delivery_secret_valid(candidate text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select candidate is not null and exists (
    select 1 from vault.decrypted_secrets
    where name = 'daymark_notification_worker_secret'
      and decrypted_secret = candidate
  );
$$;

create or replace function public.daymark_claim_notification_deliveries(
  worker_secret text,
  batch_limit integer default 25
)
returns table(delivery_id uuid, recipient_email text, title text, message text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.daymark_delivery_secret_valid(worker_secret) then raise exception 'Unauthorized worker'; end if;
  return query
  with candidates as (
    select d.id from public.notification_deliveries d
    where (d.status = 'pending' and d.available_at <= now())
       or (d.status = 'processing' and d.updated_at < now() - interval '10 minutes')
    order by d.created_at
    limit greatest(1, least(batch_limit, 100))
    for update skip locked
  ), claimed as (
    update public.notification_deliveries d
    set status = 'processing', attempts = attempts + 1, updated_at = now()
    from candidates c where d.id = c.id
    returning d.id, d.recipient_email, d.title, d.message
  )
  select c.id, c.recipient_email, c.title, c.message from claimed c;
end;
$$;

create or replace function public.daymark_finish_notification_delivery(
  worker_secret text,
  target_delivery uuid,
  delivered boolean,
  external_id text default null,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.daymark_delivery_secret_valid(worker_secret) then raise exception 'Unauthorized worker'; end if;
  update public.notification_deliveries
  set status = case when delivered then 'sent' when attempts >= 5 then 'failed' else 'pending' end,
      provider_id = external_id,
      last_error = left(failure_message, 500),
      available_at = case when delivered then available_at else now() + (interval '1 minute' * greatest(1, attempts * attempts)) end,
      updated_at = now()
  where id = target_delivery and status = 'processing';
end;
$$;

revoke all on function public.daymark_add_task_comment(text, text, uuid) from public;
revoke all on function public.daymark_set_assignment_status(uuid, text) from public;
revoke all on function public.daymark_queue_due_reminders() from public;
revoke all on function public.daymark_delivery_secret_valid(text) from public;
revoke all on function public.daymark_claim_notification_deliveries(text, integer) from public;
revoke all on function public.daymark_finish_notification_delivery(text, uuid, boolean, text, text) from public;
grant execute on function public.daymark_add_task_comment(text, text, uuid) to authenticated;
grant execute on function public.daymark_set_assignment_status(uuid, text) to authenticated;
grant execute on function public.daymark_queue_due_reminders() to postgres;
grant execute on function public.daymark_claim_notification_deliveries(text, integer) to anon;
grant execute on function public.daymark_finish_notification_delivery(text, uuid, boolean, text, text) to anon;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='task_activity') then
    alter publication supabase_realtime add table public.task_activity;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_preferences') then
    alter publication supabase_realtime add table public.notification_preferences;
  end if;
end $$;

commit;
