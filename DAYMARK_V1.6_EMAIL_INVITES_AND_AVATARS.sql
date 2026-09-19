-- Daymark v1.6: email invitations and optional profile photos
-- Run after the existing v1.5 collaboration migration.
-- This migration does not use or expose a service-role key.

begin;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists avatar_url text;

create table if not exists public.daymark_email_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  task_id text,
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'cancelled', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 day'),
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  constraint daymark_email_invites_not_self check (length(trim(invitee_email)) > 3),
  constraint daymark_email_invites_task_fk
    foreign key (inviter_id, task_id)
    references public.tasks(user_id, id)
    on delete cascade
);

create index if not exists daymark_email_invites_inviter_idx
  on public.daymark_email_invites(inviter_id, created_at desc);
create index if not exists daymark_email_invites_email_idx
  on public.daymark_email_invites(lower(invitee_email), status);
create unique index if not exists daymark_email_invites_pending_unique_idx
  on public.daymark_email_invites(inviter_id, lower(invitee_email), coalesce(task_id, ''))
  where status = 'pending';

alter table public.daymark_email_invites enable row level security;

drop policy if exists "email_invites_select_sender" on public.daymark_email_invites;
create policy "email_invites_select_sender"
  on public.daymark_email_invites
  for select to authenticated
  using (inviter_id = auth.uid());

-- Inserts, claims and cancellations go through validated functions only.
drop policy if exists "email_invites_no_direct_insert" on public.daymark_email_invites;

create or replace function public.daymark_create_email_invite(
  invitee_email text,
  target_task text default null
)
returns table(invite_id uuid, invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  sender uuid := auth.uid();
  normalized_email text := lower(trim(invitee_email));
  sender_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  raw_token text := encode(gen_random_bytes(32), 'hex');
  hashed_token text := encode(digest(raw_token, 'sha256'), 'hex');
  invitation_id uuid;
  invitation_expiry timestamptz := now() + interval '1 day';
begin
  if sender is null then
    raise exception 'Authentication required';
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;

  if normalized_email = sender_email then
    raise exception 'You cannot invite yourself';
  end if;

  if target_task is not null and not exists (
    select 1 from public.tasks t
    where t.user_id = sender and t.id = target_task
  ) then
    raise exception 'Task not found or you do not own it';
  end if;

  if (
    select count(*) from public.daymark_email_invites i
    where i.inviter_id = sender and i.created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'Too many invitations sent. Please wait and try again.';
  end if;

  update public.daymark_email_invites i
  set token_hash = hashed_token,
      expires_at = invitation_expiry,
      created_at = now()
  where i.inviter_id = sender
    and lower(i.invitee_email) = normalized_email
    and i.task_id is not distinct from target_task
    and i.status = 'pending'
  returning i.id into invitation_id;

  if invitation_id is null then
    insert into public.daymark_email_invites (
      inviter_id, invitee_email, task_id, token_hash, expires_at
    ) values (
      sender, normalized_email, target_task, hashed_token, invitation_expiry
    ) returning id into invitation_id;
  end if;

  return query select invitation_id, raw_token, invitation_expiry;
end;
$$;

create or replace function public.daymark_cancel_email_invite(target_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.daymark_email_invites
  set status = 'cancelled'
  where id = target_invite
    and inviter_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Invitation is no longer available';
  end if;
end;
$$;

create or replace function public.daymark_claim_email_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  invitation public.daymark_email_invites%rowtype;
  connection_uuid uuid;
  assignment_uuid uuid;
  task_title text;
  claimant_name text;
  inviter_name text;
begin
  if me is null then
    raise exception 'Sign in to accept this invitation';
  end if;

  select i.* into invitation
  from public.daymark_email_invites i
  where i.token_hash = encode(digest(trim(invite_token), 'sha256'), 'hex')
  for update;

  if invitation.id is null or invitation.status <> 'pending' then
    raise exception 'This invitation is no longer available';
  end if;

  if invitation.expires_at <= now() then
    update public.daymark_email_invites set status = 'expired' where id = invitation.id;
    raise exception 'This invitation has expired. Ask the sender for a new one.';
  end if;

  if lower(invitation.invitee_email) <> my_email then
    raise exception 'Sign in with the email address that received this invitation';
  end if;

  if invitation.inviter_id = me then
    raise exception 'You cannot claim your own invitation';
  end if;

  select c.id into connection_uuid
  from public.connections c
  where (c.requester_id = invitation.inviter_id and c.addressee_id = me)
     or (c.requester_id = me and c.addressee_id = invitation.inviter_id)
  limit 1
  for update;

  if connection_uuid is null then
    insert into public.connections (
      requester_id, addressee_id, status, responded_at, updated_at
    ) values (
      invitation.inviter_id, me, 'accepted', now(), now()
    ) returning id into connection_uuid;
  else
    update public.connections
    set status = 'accepted', responded_at = now(), updated_at = now()
    where id = connection_uuid;
  end if;

  select coalesce(nullif(trim(display_name), ''), email, 'A Daymark user')
    into claimant_name from public.profiles where id = me;
  select coalesce(nullif(trim(display_name), ''), email, 'A Daymark user')
    into inviter_name from public.profiles where id = invitation.inviter_id;

  insert into public.notifications (
    user_id, actor_id, type, title, message, connection_id
  ) values (
    invitation.inviter_id, me, 'contact_accepted',
    'Invitation accepted', claimant_name || ' joined you on Daymark.', connection_uuid
  );

  if invitation.task_id is not null then
    select t.title into task_title
    from public.tasks t
    where t.user_id = invitation.inviter_id and t.id = invitation.task_id;

    if task_title is not null then
      insert into public.task_assignments (
        task_id, owner_id, assignee_id, status, assigned_at, responded_at, completed_at, updated_at
      ) values (
        invitation.task_id, invitation.inviter_id, me, 'pending', now(), null, null, now()
      )
      on conflict (task_id, assignee_id) do update
      set owner_id = excluded.owner_id,
          status = 'pending',
          assigned_at = now(),
          responded_at = null,
          completed_at = null,
          updated_at = now()
      where public.task_assignments.owner_id = invitation.inviter_id
      returning id into assignment_uuid;

      insert into public.notifications (
        user_id, actor_id, type, title, message, task_id, assignment_id
      ) values (
        me, invitation.inviter_id, 'task_assigned',
        'New task assigned to you', inviter_name || ' assigned: ' || task_title,
        invitation.task_id, assignment_uuid
      );
    end if;
  end if;

  update public.daymark_email_invites
  set status = 'claimed', claimed_by = me, claimed_at = now()
  where id = invitation.id;

  return jsonb_build_object(
    'invite_id', invitation.id,
    'connection_id', connection_uuid,
    'task_id', invitation.task_id,
    'assignment_id', assignment_uuid
  );
end;
$$;

revoke all on function public.daymark_create_email_invite(text, text) from public;
revoke all on function public.daymark_cancel_email_invite(uuid) from public;
revoke all on function public.daymark_claim_email_invite(text) from public;
grant execute on function public.daymark_create_email_invite(text, text) to authenticated;
grant execute on function public.daymark_cancel_email_invite(uuid) to authenticated;
grant execute on function public.daymark_claim_email_invite(text) to authenticated;

-- Public profile images. Only the owner may create, replace or remove their file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('daymark-avatars', 'daymark-avatars', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists "daymark_avatar_public_read" on storage.objects;
create policy "daymark_avatar_public_read"
  on storage.objects for select to public
  using (bucket_id = 'daymark-avatars');

drop policy if exists "daymark_avatar_owner_insert" on storage.objects;
create policy "daymark_avatar_owner_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'daymark-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "daymark_avatar_owner_update" on storage.objects;
create policy "daymark_avatar_owner_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'daymark-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'daymark-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "daymark_avatar_owner_delete" on storage.objects;
create policy "daymark_avatar_owner_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'daymark-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'daymark_email_invites'
  ) then
    alter publication supabase_realtime add table public.daymark_email_invites;
  end if;
end $$;

commit;
