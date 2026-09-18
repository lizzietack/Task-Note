-- Daymark v1.4 cloud schema
-- Run this entire file once in Supabase Dashboard -> SQL Editor.
-- It is safe to re-run: tables, policies and storage bucket are created idempotently where practical.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default '',
  completed boolean not null default false,
  date date,
  time time,
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  category text not null default 'Personal',
  list_name text not null default 'inbox' check (list_name in ('inbox','today','upcoming','later')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none','daily','weekly','monthly','yearly')),
  reminder text not null default 'None',
  note text not null default '',
  subtasks jsonb not null default '[]'::jsonb,
  source jsonb not null default '{"type":"manual"}'::jsonb,
  recurring_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default '',
  body text not null default '',
  note_type text not null default 'text' check (note_type in ('text','checklist')),
  pinned boolean not null default false,
  archived boolean not null default false,
  label text not null default 'Personal',
  color text not null default 'plain',
  checklist jsonb not null default '[]'::jsonb,
  source jsonb not null default '{"type":"manual"}'::jsonb,
  attachment_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.attachments (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  note_id text not null,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  kind text not null default 'file' check (kind in ('file','image','audio')),
  storage_path text not null,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint attachments_note_fk foreign key (user_id, note_id) references public.notes(user_id, id) on delete cascade
);

-- Tombstones prevent a stale offline device from resurrecting items deleted elsewhere.
create table if not exists public.deleted_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('task','note')),
  entity_id text not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, entity_type, entity_id)
);

create index if not exists tasks_user_date_idx on public.tasks(user_id, date);
create index if not exists tasks_user_updated_idx on public.tasks(user_id, updated_at desc);
create index if not exists notes_user_updated_idx on public.notes(user_id, updated_at desc);
create index if not exists attachments_user_note_idx on public.attachments(user_id, note_id);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.deleted_items enable row level security;

-- Recreate policies so a re-run does not create duplicates.
drop policy if exists "profiles_own_all" on public.profiles;
create policy "profiles_own_all" on public.profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "tasks_own_all" on public.tasks;
create policy "tasks_own_all" on public.tasks for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_own_all" on public.notes;
create policy "notes_own_all" on public.notes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "attachments_own_all" on public.attachments;
create policy "attachments_own_all" on public.attachments for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "deleted_items_own_all" on public.deleted_items;
create policy "deleted_items_own_all" on public.deleted_items for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Automatically create the profile row when a Supabase Auth user is created.
create or replace function public.handle_new_daymark_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_daymark on auth.users;
create trigger on_auth_user_created_daymark
after insert on auth.users
for each row execute procedure public.handle_new_daymark_user();

-- Private object storage. Files live under <auth.uid()>/notes/...
insert into storage.buckets (id, name, public, file_size_limit)
values ('daymark-attachments', 'daymark-attachments', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "daymark_storage_select" on storage.objects;
create policy "daymark_storage_select" on storage.objects for select to authenticated
using (bucket_id = 'daymark-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "daymark_storage_insert" on storage.objects;
create policy "daymark_storage_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'daymark-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "daymark_storage_update" on storage.objects;
create policy "daymark_storage_update" on storage.objects for update to authenticated
using (bucket_id = 'daymark-attachments' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'daymark-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "daymark_storage_delete" on storage.objects;
create policy "daymark_storage_delete" on storage.objects for delete to authenticated
using (bucket_id = 'daymark-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime for cross-device changes.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notes') then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;
