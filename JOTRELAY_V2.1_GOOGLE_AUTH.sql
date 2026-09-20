-- JotRelay v2.1: use Google identity metadata for new profiles.
-- Run once after DAYMARK_V2.0_COLLABORATION_WORKSPACE.sql.

begin;

create or replace function public.handle_new_daymark_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  profile_name text;
  profile_avatar text;
begin
  profile_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1)
  );
  profile_avatar := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'picture'), '')
  );

  insert into public.profiles (id, display_name, email, avatar_url)
  values (new.id, profile_name, new.email, profile_avatar)
  on conflict (id) do update set
    display_name = coalesce(nullif(trim(public.profiles.display_name), ''), excluded.display_name),
    email = coalesce(public.profiles.email, excluded.email),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$$;

commit;
