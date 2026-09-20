-- JotRelay v2.0: shared workspaces, multiple collaborators, mentions,
-- task attachments, delegated recurrence, calendar feeds and account deletion.
-- Apply after 005_web_push_notifications.sql.

begin;

create extension if not exists pgcrypto;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in (
    'contact_invite', 'contact_accepted', 'contact_declined', 'contact_removed',
    'task_assigned', 'task_accepted', 'task_declined', 'task_completed',
    'assignment_accepted', 'assignment_declined', 'assignment_completed',
    'assignment_cancelled', 'comment_added', 'task_comment', 'comment_mention',
    'task_updated', 'task_reminder', 'shared_list_added', 'task_attachment_added'
  )
);

create table if not exists public.shared_task_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  color text not null default 'mint' check (color in ('mint','blue','sand','rose','plain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_list_members (
  list_id uuid not null references public.shared_task_lists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','editor')),
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

alter table public.tasks add column if not exists shared_list_id uuid
  references public.shared_task_lists(id) on delete set null;
create index if not exists tasks_shared_list_idx on public.tasks(shared_list_id);
create index if not exists shared_list_members_user_idx on public.shared_list_members(user_id);

create or replace function public.daymark_shared_list_can_view(target_list uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shared_task_lists l
    where l.id = target_list
      and (l.owner_id = target_user or exists (
        select 1 from public.shared_list_members m
        where m.list_id = l.id and m.user_id = target_user
      ))
  );
$$;

create or replace function public.daymark_shared_list_is_owner(target_list uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.shared_task_lists where id = target_list and owner_id = target_user);
$$;

alter table public.shared_task_lists enable row level security;
alter table public.shared_list_members enable row level security;

drop policy if exists "shared_lists_read" on public.shared_task_lists;
create policy "shared_lists_read" on public.shared_task_lists for select to authenticated
using (public.daymark_shared_list_can_view(id));
drop policy if exists "shared_lists_owner_insert" on public.shared_task_lists;
create policy "shared_lists_owner_insert" on public.shared_task_lists for insert to authenticated
with check (owner_id = auth.uid());
drop policy if exists "shared_lists_owner_update" on public.shared_task_lists;
create policy "shared_lists_owner_update" on public.shared_task_lists for update to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "shared_lists_owner_delete" on public.shared_task_lists;
create policy "shared_lists_owner_delete" on public.shared_task_lists for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists "shared_list_members_read" on public.shared_list_members;
create policy "shared_list_members_read" on public.shared_list_members for select to authenticated
using (public.daymark_shared_list_can_view(list_id));
drop policy if exists "shared_list_members_owner_all" on public.shared_list_members;
create policy "shared_list_members_owner_all" on public.shared_list_members for all to authenticated
using (public.daymark_shared_list_is_owner(list_id))
with check (public.daymark_shared_list_is_owner(list_id));

grant select, insert, update, delete on public.shared_task_lists to authenticated;
grant select, insert, update, delete on public.shared_list_members to authenticated;

-- Shared-list members receive normal task assignments, preserving the existing
-- permission model and all assignment response flows.
create or replace function public.daymark_save_shared_list(
  target_list uuid,
  list_name text,
  member_ids uuid[] default '{}'::uuid[],
  list_color text default 'mint'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  saved_id uuid;
  member uuid;
  removed_member uuid;
  task_row record;
  owner_name text;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if length(trim(list_name)) < 1 or length(trim(list_name)) > 80 then raise exception 'List names must contain 1–80 characters'; end if;
  if list_color not in ('mint','blue','sand','rose','plain') then raise exception 'Invalid list color'; end if;

  if target_list is null then
    insert into public.shared_task_lists(owner_id, name, color)
    values (me, trim(list_name), list_color) returning id into saved_id;
  else
    update public.shared_task_lists set name = trim(list_name), color = list_color, updated_at = now()
    where id = target_list and owner_id = me returning id into saved_id;
    if saved_id is null then raise exception 'Shared list not found'; end if;
  end if;

  for member in select distinct unnest(coalesce(member_ids, '{}'::uuid[])) loop
    if member = me or not public.daymark_are_contacts(me, member) then
      raise exception 'Shared-list members must be accepted JotRelay contacts';
    end if;
  end loop;

  for removed_member in
    select m.user_id from public.shared_list_members m
    where m.list_id = saved_id and not (m.user_id = any(coalesce(member_ids, '{}'::uuid[])))
  loop
    for task_row in
      select a.id from public.task_assignments a
      join public.tasks t on t.user_id = a.owner_id and t.id = a.task_id
      where t.user_id = me and t.shared_list_id = saved_id
        and a.assignee_id = removed_member and a.status in ('pending','accepted')
    loop
      perform public.daymark_cancel_assignment(task_row.id);
    end loop;
  end loop;

  delete from public.shared_list_members m
  where m.list_id = saved_id and not (m.user_id = any(coalesce(member_ids, '{}'::uuid[])));

  select coalesce(nullif(trim(p.display_name), ''), p.email, 'A JotRelay user')
    into owner_name from public.profiles p where p.id = me;

  for member in select distinct unnest(coalesce(member_ids, '{}'::uuid[])) loop
    insert into public.shared_list_members(list_id, user_id)
    values (saved_id, member) on conflict (list_id, user_id) do nothing;
    if found then
      insert into public.notifications(user_id, actor_id, type, title, message)
      values (member, me, 'shared_list_added', 'Added to a shared list',
        owner_name || ' added you to ' || trim(list_name) || '.');
    end if;
    for task_row in select t.id from public.tasks t where t.user_id = me and t.shared_list_id = saved_id loop
      if not exists (
        select 1 from public.task_assignments a
        where a.task_id = task_row.id and a.owner_id = me and a.assignee_id = member
          and a.status in ('pending','accepted')
      ) then
        perform public.daymark_assign_or_reactivate_task(task_row.id, member);
      end if;
    end loop;
  end loop;
  return saved_id;
end;
$$;

create or replace function public.daymark_delete_shared_list(target_list uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.tasks set shared_list_id = null where shared_list_id = target_list and user_id = auth.uid();
  delete from public.shared_task_lists where id = target_list and owner_id = auth.uid();
  if not found then raise exception 'Shared list not found'; end if;
end;
$$;

create or replace function public.daymark_set_task_collaborators(
  target_task text,
  target_users uuid[] default '{}'::uuid[],
  target_list uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  recipient uuid;
  recipients uuid[] := coalesce(target_users, '{}'::uuid[]);
  assigned_count integer := 0;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.tasks where user_id = me and id = target_task) then raise exception 'Task not found'; end if;
  if target_list is not null then
    if not public.daymark_shared_list_is_owner(target_list, me) then raise exception 'Shared list not found'; end if;
    select array_agg(distinct value) into recipients from (
      select unnest(recipients) value
      union select user_id from public.shared_list_members where list_id = target_list
    ) combined;
  end if;
  update public.tasks set shared_list_id = target_list, updated_at = now()
  where user_id = me and id = target_task;

  for recipient in select distinct unnest(coalesce(recipients, '{}'::uuid[])) loop
    if not exists (
      select 1 from public.task_assignments a where a.task_id = target_task
        and a.owner_id = me and a.assignee_id = recipient and a.status in ('pending','accepted')
    ) then
      perform public.daymark_assign_or_reactivate_task(target_task, recipient);
      assigned_count := assigned_count + 1;
    end if;
  end loop;
  return assigned_count;
end;
$$;

-- Files attached to a task are separate from offline note attachments.
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes between 0 and 10485760),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  constraint task_attachments_task_fk foreign key (owner_id, task_id)
    references public.tasks(user_id, id) on delete cascade
);
create index if not exists task_attachments_task_idx on public.task_attachments(owner_id, task_id, created_at);

create or replace function public.daymark_can_access_task(target_owner uuid, target_task text, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user is not null and (
    target_owner = target_user
    or exists (
      select 1 from public.task_assignments a
      where a.owner_id = target_owner and a.task_id = target_task
        and a.assignee_id = target_user and a.status in ('pending','accepted','completed')
    )
  );
$$;

alter table public.task_attachments enable row level security;
drop policy if exists "task_attachments_participants_read" on public.task_attachments;
create policy "task_attachments_participants_read" on public.task_attachments for select to authenticated
using (public.daymark_can_access_task(owner_id, task_id));
drop policy if exists "task_attachments_participants_insert" on public.task_attachments;
create policy "task_attachments_participants_insert" on public.task_attachments for insert to authenticated
with check (uploader_id = auth.uid() and (
  owner_id = auth.uid() or exists (
    select 1 from public.task_assignments a where a.owner_id = task_attachments.owner_id
      and a.task_id = task_attachments.task_id and a.assignee_id = auth.uid()
      and a.status in ('accepted','completed')
  )
));
drop policy if exists "task_attachments_owner_or_uploader_delete" on public.task_attachments;
create policy "task_attachments_owner_or_uploader_delete" on public.task_attachments for delete to authenticated
using (owner_id = auth.uid() or uploader_id = auth.uid());
grant select, insert, delete on public.task_attachments to authenticated;

create or replace function public.daymark_storage_task_access(object_name text, target_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  parts text[] := storage.foldername(object_name);
  task_owner uuid;
begin
  if array_length(parts, 1) < 3 or parts[2] <> 'tasks' then return false; end if;
  begin task_owner := parts[1]::uuid; exception when others then return false; end;
  return public.daymark_can_access_task(task_owner, parts[3], target_user);
end;
$$;

create or replace function public.daymark_storage_task_upload(object_name text, target_user uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare parts text[] := storage.foldername(object_name); task_owner uuid;
begin
  if array_length(parts, 1) < 3 or parts[2] <> 'tasks' then return false; end if;
  begin task_owner := parts[1]::uuid; exception when others then return false; end;
  return task_owner = target_user or exists (
    select 1 from public.task_assignments a where a.owner_id = task_owner and a.task_id = parts[3]
      and a.assignee_id = target_user and a.status in ('accepted','completed')
  );
end;
$$;

create or replace function public.daymark_storage_task_delete(object_name text, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.task_attachments a
    where a.storage_path = object_name and (a.owner_id = target_user or a.uploader_id = target_user)
  );
$$;

drop policy if exists "jotrelay_task_storage_select" on storage.objects;
create policy "jotrelay_task_storage_select" on storage.objects for select to authenticated
using (bucket_id = 'daymark-attachments' and public.daymark_storage_task_access(name));
drop policy if exists "jotrelay_task_storage_insert" on storage.objects;
create policy "jotrelay_task_storage_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'daymark-attachments' and public.daymark_storage_task_upload(name));
drop policy if exists "jotrelay_task_storage_delete" on storage.objects;
create policy "jotrelay_task_storage_delete" on storage.objects for delete to authenticated
using (bucket_id = 'daymark-attachments' and public.daymark_storage_task_delete(name));

create or replace function public.daymark_notify_task_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient uuid; actor_name text; task_title text;
begin
  select coalesce(nullif(trim(display_name), ''), email, 'A JotRelay user') into actor_name
    from public.profiles where id = new.uploader_id;
  select title into task_title from public.tasks where user_id = new.owner_id and id = new.task_id;
  for recipient in
    select new.owner_id where new.owner_id <> new.uploader_id
    union
    select a.assignee_id from public.task_assignments a
    where a.owner_id = new.owner_id and a.task_id = new.task_id
      and a.status in ('accepted','completed') and a.assignee_id <> new.uploader_id
  loop
    insert into public.notifications(user_id, actor_id, type, title, message, task_id)
    values (recipient, new.uploader_id, 'task_attachment_added', 'New task attachment',
      actor_name || ' attached ' || new.name || ' to ' || coalesce(task_title, 'a shared task') || '.', new.task_id);
  end loop;
  return new;
end;
$$;
drop trigger if exists daymark_task_attachment_notification on public.task_attachments;
create trigger daymark_task_attachment_notification after insert on public.task_attachments
for each row execute function public.daymark_notify_task_attachment();

-- Stable, permission-checked comment mentions.
create table if not exists public.comment_mentions (
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_mentions enable row level security;
drop policy if exists "comment_mentions_participants_read" on public.comment_mentions;
create policy "comment_mentions_participants_read" on public.comment_mentions for select to authenticated
using (exists (
  select 1 from public.task_comments c
  join public.task_assignments a on a.task_id = c.task_id
  where c.id = comment_mentions.comment_id
    and (a.owner_id = auth.uid() or (a.assignee_id = auth.uid() and a.status in ('pending','accepted','completed')))
));
grant select on public.comment_mentions to authenticated;

create or replace function public.daymark_log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare owner uuid;
begin
  select a.owner_id into owner from public.task_assignments a
  where a.task_id = new.task_id order by a.assigned_at limit 1;
  if owner is not null then
    insert into public.task_activity(task_id, owner_id, actor_id, event_type)
    values (new.task_id, owner, new.author_id, 'commented');
  end if;
  return new;
end;
$$;

create or replace function public.daymark_add_task_comment_v2(
  target_task text,
  comment_body text,
  request_nonce uuid,
  mentioned_users uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  text_body text := trim(comment_body);
  owner uuid;
  task_title text;
  actor_name text;
  existing_id uuid;
  created_id uuid;
  recipient uuid;
  is_mention boolean;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if request_nonce is null then raise exception 'A request identifier is required'; end if;
  if length(text_body) < 1 or length(text_body) > 2000 then raise exception 'Comments must contain 1–2,000 characters.'; end if;
  select id into existing_id from public.task_comments where author_id = me and client_nonce = request_nonce;
  if existing_id is not null then return existing_id; end if;

  select a.owner_id into owner from public.task_assignments a
  where a.task_id = target_task order by a.assigned_at limit 1;
  if owner is null or not public.daymark_can_access_task(owner, target_task, me)
    or (me <> owner and not exists (
      select 1 from public.task_assignments where owner_id = owner and task_id = target_task
        and assignee_id = me and status in ('accepted','completed')
    )) then raise exception 'You cannot comment on this task'; end if;

  insert into public.task_comments(task_id, author_id, body, client_nonce)
  values (target_task, me, text_body, request_nonce) returning id into created_id;
  select title into task_title from public.tasks where user_id = owner and id = target_task;
  select coalesce(nullif(trim(display_name), ''), email, 'A JotRelay user') into actor_name
    from public.profiles where id = me;

  for recipient in
    select owner where owner <> me
    union
    select a.assignee_id from public.task_assignments a
    where a.task_id = target_task and a.owner_id = owner
      and a.status in ('accepted','completed') and a.assignee_id <> me
  loop
    is_mention := recipient = any(coalesce(mentioned_users, '{}'::uuid[]));
    if is_mention then
      insert into public.comment_mentions(comment_id, user_id, mentioned_by)
      values (created_id, recipient, me) on conflict do nothing;
    end if;
    insert into public.notifications(user_id, actor_id, type, title, message, task_id)
    values (recipient, me,
      case when is_mention then 'comment_mention' else 'task_comment' end,
      case when is_mention then actor_name || ' mentioned you' else 'New task comment' end,
      actor_name || ' commented on ' || coalesce(task_title, 'a shared task') || '.', target_task);
  end loop;
  return created_id;
end;
$$;

-- Recurring tasks inherit every still-relevant collaborator as a fresh pending assignment.
create or replace function public.daymark_inherit_recurring_collaborators()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient uuid;
begin
  if new.recurring_from is null then return new; end if;
  for recipient in
    select distinct a.assignee_id from public.task_assignments a
    where a.owner_id = new.user_id and a.task_id = new.recurring_from
      and a.status in ('pending','accepted','completed')
  loop
    if public.daymark_are_contacts(new.user_id, recipient) then
      begin perform public.daymark_assign_or_reactivate_task(new.id, recipient);
      exception when others then null;
      end;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists daymark_recurring_collaborators on public.tasks;
create trigger daymark_recurring_collaborators after insert on public.tasks
for each row when (new.recurring_from is not null)
execute function public.daymark_inherit_recurring_collaborators();

-- Private calendar-feed tokens can be rotated at any time.
create table if not exists public.calendar_feed_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.calendar_feed_tokens enable row level security;
drop policy if exists "calendar_tokens_own_read" on public.calendar_feed_tokens;
create policy "calendar_tokens_own_read" on public.calendar_feed_tokens for select to authenticated using (user_id = auth.uid());
grant select on public.calendar_feed_tokens to authenticated;

create or replace function public.daymark_get_calendar_token(rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid(); result text;
begin
  if me is null then raise exception 'Authentication required'; end if;
  insert into public.calendar_feed_tokens(user_id) values (me)
  on conflict (user_id) do update set
    token = case when rotate then encode(gen_random_bytes(32), 'hex') else calendar_feed_tokens.token end,
    updated_at = now()
  returning token into result;
  return result;
end;
$$;

create or replace function public.daymark_calendar_feed(feed_token text)
returns table(id text, title text, task_date date, task_time time, note text, completed boolean, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.title, t.date, t.time, t.note, t.completed, t.updated_at
  from public.calendar_feed_tokens f
  join public.tasks t on t.user_id = f.user_id
  where f.token = feed_token and t.date is not null
  order by t.date, t.time nulls last, t.id;
$$;

create or replace function public.daymark_delete_account(confirm_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Authentication required'; end if;
  if confirm_text <> 'DELETE' then raise exception 'Type DELETE to confirm account deletion'; end if;
  delete from auth.users where id = me;
  return found;
end;
$$;

create or replace function public.daymark_notification_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare pref public.notification_preferences%rowtype;
begin
  select * into pref from public.notification_preferences where user_id = new.user_id;
  if not found then return new; end if;
  if new.type in ('contact_invite','contact_accepted','contact_declined','contact_removed','shared_list_added')
    and not pref.contact_updates then return null; end if;
  if new.type in ('task_assigned','task_accepted','task_declined','task_completed','assignment_accepted',
    'assignment_declined','assignment_completed','assignment_cancelled','task_updated','task_attachment_added')
    and not pref.assignment_updates then return null; end if;
  if new.type in ('comment_added','task_comment','comment_mention') and not pref.comment_updates then return null; end if;
  if new.type = 'task_reminder' and not pref.task_reminders then return null; end if;
  return new;
end;
$$;

revoke all on function public.daymark_save_shared_list(uuid,text,uuid[],text) from public;
revoke all on function public.daymark_delete_shared_list(uuid) from public;
revoke all on function public.daymark_set_task_collaborators(text,uuid[],uuid) from public;
revoke all on function public.daymark_add_task_comment_v2(text,text,uuid,uuid[]) from public;
revoke all on function public.daymark_get_calendar_token(boolean) from public;
revoke all on function public.daymark_calendar_feed(text) from public;
revoke all on function public.daymark_delete_account(text) from public;
grant execute on function public.daymark_save_shared_list(uuid,text,uuid[],text) to authenticated;
grant execute on function public.daymark_delete_shared_list(uuid) to authenticated;
grant execute on function public.daymark_set_task_collaborators(text,uuid[],uuid) to authenticated;
grant execute on function public.daymark_add_task_comment_v2(text,text,uuid,uuid[]) to authenticated;
grant execute on function public.daymark_get_calendar_token(boolean) to authenticated;
grant execute on function public.daymark_calendar_feed(text) to anon, authenticated;
grant execute on function public.daymark_delete_account(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_task_lists') then
    alter publication supabase_realtime add table public.shared_task_lists;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='shared_list_members') then
    alter publication supabase_realtime add table public.shared_list_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='task_attachments') then
    alter publication supabase_realtime add table public.task_attachments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='comment_mentions') then
    alter publication supabase_realtime add table public.comment_mentions;
  end if;
end $$;

commit;
