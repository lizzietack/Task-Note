-- Daymark v1.8: owner controls, contact removal and access revocation
-- Run after 003_reliable_delivery.sql.

begin;

-- Preserve every legacy notification value while adding contact removal.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in (
    'contact_invite', 'contact_accepted', 'contact_declined', 'contact_removed',
    'task_assigned', 'task_accepted', 'task_declined', 'task_completed',
    'assignment_accepted', 'assignment_declined', 'assignment_completed',
    'assignment_cancelled', 'comment_added',
    'task_comment', 'task_updated', 'task_reminder'
  )
);

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

  if new.type in ('contact_invite', 'contact_accepted', 'contact_declined', 'contact_removed')
    and not pref.contact_updates then return null; end if;
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

-- Attribute cancellation to the person who initiated it. Reactivating a
-- terminal assignment is also recorded as a fresh assignment event.
create or replace function public.daymark_log_assignment_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
  actor uuid;
  requested_actor text := current_setting('daymark.actor_id', true);
begin
  if tg_op = 'INSERT' then
    event_name := 'assigned';
    actor := new.owner_id;
  elsif old.status is not distinct from new.status then
    return new;
  else
    event_name := case new.status
      when 'pending' then 'assigned'
      when 'accepted' then 'accepted'
      when 'declined' then 'declined'
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      else null end;
    actor := case
      when new.status in ('pending', 'cancelled')
        then coalesce(nullif(requested_actor, '')::uuid, new.owner_id)
      else new.assignee_id end;
  end if;
  if event_name is not null then
    insert into public.task_activity(task_id, owner_id, actor_id, assignment_id, event_type)
    values (new.task_id, new.owner_id, actor, new.id, event_name);
  end if;
  return new;
end;
$$;

-- Send a first request or safely reconnect after either person previously
-- declined or removed the relationship.
create or replace function public.daymark_invite_or_reconnect_contact(invitee_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sender uuid := auth.uid();
  recipient uuid;
  connection_row public.connections%rowtype;
  sender_name text;
begin
  if sender is null then raise exception 'Authentication required'; end if;

  select p.id into recipient
  from public.profiles p
  where lower(p.email) = lower(trim(invitee_email))
  limit 1;

  if recipient is null then raise exception 'No Daymark user found with that email'; end if;
  if recipient = sender then raise exception 'You cannot add yourself'; end if;

  if (
    select count(*) from public.connections c
    where c.requester_id = sender
      and c.status = 'pending'
      and c.updated_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'Too many invitations sent. Please wait and try again.';
  end if;

  select c.* into connection_row
  from public.connections c
  where (c.requester_id = sender and c.addressee_id = recipient)
     or (c.requester_id = recipient and c.addressee_id = sender)
  limit 1
  for update;

  if connection_row.id is null then
    insert into public.connections(requester_id, addressee_id, status)
    values (sender, recipient, 'pending')
    returning * into connection_row;
  elsif connection_row.status = 'accepted' then
    raise exception 'You are already Daymark contacts';
  elsif connection_row.status = 'pending' then
    raise exception 'A Daymark contact request is already pending';
  else
    update public.connections
    set requester_id = sender,
        addressee_id = recipient,
        status = 'pending',
        responded_at = null,
        created_at = now(),
        updated_at = now()
    where id = connection_row.id
    returning * into connection_row;
  end if;

  select coalesce(nullif(trim(p.display_name), ''), p.email, 'A Daymark user')
    into sender_name from public.profiles p where p.id = sender;

  insert into public.notifications(user_id, actor_id, type, title, message, connection_id)
  values (recipient, sender, 'contact_invite', 'New Daymark contact request',
    sender_name || ' wants to connect with you on Daymark.', connection_row.id);

  return connection_row.id;
end;
$$;

-- Assign a new contact or reactivate the same assignment after it reached a
-- terminal state. Active duplicates remain rejected.
create or replace function public.daymark_assign_or_reactivate_task(
  target_task text,
  target_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  assignment_row public.task_assignments%rowtype;
  task_title text;
  owner_name text;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if not public.daymark_are_contacts(me, target_user) then
    raise exception 'You can only assign tasks to accepted Daymark contacts';
  end if;

  select t.title into task_title
  from public.tasks t
  where t.user_id = me and t.id = target_task;
  if task_title is null then raise exception 'Task not found or you do not own it'; end if;

  select a.* into assignment_row
  from public.task_assignments a
  where a.task_id = target_task and a.assignee_id = target_user
  limit 1
  for update;

  perform set_config('daymark.actor_id', me::text, true);
  if assignment_row.id is null then
    insert into public.task_assignments(task_id, owner_id, assignee_id, status)
    values (target_task, me, target_user, 'pending')
    returning * into assignment_row;
  elsif assignment_row.owner_id <> me then
    raise exception 'Assignment belongs to another task owner';
  elsif assignment_row.status in ('pending', 'accepted') then
    raise exception 'This assignment is already active';
  else
    update public.task_assignments
    set status = 'pending', assigned_at = now(), responded_at = null,
        completed_at = null, updated_at = now()
    where id = assignment_row.id
    returning * into assignment_row;
  end if;

  select coalesce(nullif(trim(p.display_name), ''), p.email, 'A Daymark user')
    into owner_name from public.profiles p where p.id = me;
  insert into public.notifications(user_id, actor_id, type, title, message, task_id, assignment_id)
  values (target_user, me, 'task_assigned', 'New task assigned to you',
    owner_name || ' assigned: ' || task_title, target_task, assignment_row.id);

  return assignment_row.id;
end;
$$;

create or replace function public.daymark_cancel_assignment(target_assignment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  assignment_row public.task_assignments%rowtype;
  task_title text;
  owner_name text;
begin
  if me is null then raise exception 'Authentication required'; end if;
  select a.* into assignment_row
  from public.task_assignments a
  where a.id = target_assignment and a.owner_id = me
  for update;
  if assignment_row.id is null then raise exception 'Assignment not found'; end if;
  if assignment_row.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'replayed', true);
  end if;
  if assignment_row.status not in ('pending', 'accepted') then
    raise exception 'This assignment can no longer be cancelled';
  end if;

  perform set_config('daymark.actor_id', me::text, true);
  update public.task_assignments
  set status = 'cancelled', responded_at = coalesce(responded_at, now()), updated_at = now()
  where id = assignment_row.id;

  select t.title into task_title from public.tasks t
    where t.user_id = me and t.id = assignment_row.task_id;
  select coalesce(nullif(trim(p.display_name), ''), p.email, 'A Daymark user')
    into owner_name from public.profiles p where p.id = me;
  insert into public.notifications(user_id, actor_id, type, title, message, task_id, assignment_id)
  values (assignment_row.assignee_id, me, 'assignment_cancelled', 'Assignment cancelled',
    owner_name || ' cancelled: ' || coalesce(task_title, 'a shared task'),
    assignment_row.task_id, assignment_row.id);

  return jsonb_build_object('status', 'cancelled', 'replayed', false);
end;
$$;

-- Close a sent request or remove an accepted contact. Removing a contact also
-- revokes every active shared task between the two accounts in both directions.
create or replace function public.daymark_close_connection(target_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  connection_row public.connections%rowtype;
  other_user uuid;
  actor_name text;
  cancelled_count integer := 0;
begin
  if me is null then raise exception 'Authentication required'; end if;
  select c.* into connection_row
  from public.connections c
  where c.id = target_connection
    and (c.requester_id = me or c.addressee_id = me)
  for update;
  if connection_row.id is null then raise exception 'Contact relationship not found'; end if;
  if connection_row.status = 'cancelled' then
    return jsonb_build_object('status', 'cancelled', 'assignments_cancelled', 0, 'replayed', true);
  end if;
  if connection_row.status = 'pending' and connection_row.requester_id <> me then
    raise exception 'Only the sender can cancel this request';
  end if;
  if connection_row.status not in ('pending', 'accepted') then
    raise exception 'This contact relationship is already closed';
  end if;

  other_user := case when connection_row.requester_id = me
    then connection_row.addressee_id else connection_row.requester_id end;

  update public.connections
  set status = 'cancelled', responded_at = coalesce(responded_at, now()), updated_at = now()
  where id = connection_row.id;

  if connection_row.status = 'accepted' then
    perform set_config('daymark.actor_id', me::text, true);
    update public.task_assignments
    set status = 'cancelled', responded_at = coalesce(responded_at, now()), updated_at = now()
    where status in ('pending', 'accepted')
      and ((owner_id = me and assignee_id = other_user)
        or (owner_id = other_user and assignee_id = me));
    get diagnostics cancelled_count = row_count;

    select coalesce(nullif(trim(p.display_name), ''), p.email, 'A Daymark user')
      into actor_name from public.profiles p where p.id = me;
    insert into public.notifications(user_id, actor_id, type, title, message, connection_id)
    values (other_user, me, 'contact_removed', 'Daymark contact removed',
      actor_name || ' ended your Daymark contact connection.', connection_row.id);
  end if;

  return jsonb_build_object('status', 'cancelled',
    'assignments_cancelled', cancelled_count, 'replayed', false);
end;
$$;

-- Owners keep their task discussion history. A former assignee loses comment
-- access as soon as the assignment is declined or cancelled.
drop policy if exists "comments_select_involved" on public.task_comments;
create policy "comments_select_involved" on public.task_comments
for select to authenticated using (
  exists (
    select 1 from public.task_assignments a
    where a.task_id = task_comments.task_id
      and (a.owner_id = auth.uid()
        or (a.assignee_id = auth.uid() and a.status in ('pending', 'accepted', 'completed')))
  )
);

-- Closed relationships no longer expose names, email addresses or avatars.
drop policy if exists "profiles_collaboration_read" on public.profiles;
create policy "profiles_collaboration_read" on public.profiles
for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.connections c
    where c.status in ('pending', 'accepted')
      and ((c.requester_id = auth.uid() and c.addressee_id = profiles.id)
        or (c.addressee_id = auth.uid() and c.requester_id = profiles.id))
  )
);

revoke all on function public.daymark_invite_or_reconnect_contact(text) from public;
revoke all on function public.daymark_assign_or_reactivate_task(text, uuid) from public;
revoke all on function public.daymark_cancel_assignment(uuid) from public;
revoke all on function public.daymark_close_connection(uuid) from public;
grant execute on function public.daymark_invite_or_reconnect_contact(text) to authenticated;
grant execute on function public.daymark_assign_or_reactivate_task(text, uuid) to authenticated;
grant execute on function public.daymark_cancel_assignment(uuid) to authenticated;
grant execute on function public.daymark_close_connection(uuid) to authenticated;

commit;
