# JotRelay v2.0 collaboration workspace

This upgrade adds shared lists, several collaborators per task, collaborator files, comment mentions, recurring delegation, private calendar feeds and account deletion. It uses the existing authenticated Supabase client and does not place a service-role key in the browser or calendar function.

## 1. Apply the additive migration

Open the existing JotRelay project in **Supabase → SQL Editor** and run `DAYMARK_V2.0_COLLABORATION_WORKSPACE.sql` once after the v1.9 migration.

The migration adds the new tables, row-level security, realtime publication entries and permission-checked functions. It also extends the existing notification types so the v1.9 worker can deliver mention, attachment and shared-list alerts.

## 2. Deploy the calendar feed

Deploy `supabase/functions/jotrelay-calendar-feed`. Turn **Verify JWT** off for this function because calendar applications cannot send a Supabase user token. Access is protected by a random 256-bit feed token, and the function uses Supabase's built-in anon key to call the token-checked database function.

No extra function secret or Vercel environment variable is required. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied automatically by Supabase.

## 3. Verify the upgrade

Use two or three test accounts:

1. Accept the accounts as contacts and add two people to one shared list.
2. Create a task in that list and confirm each collaborator receives a separate pending assignment.
3. Accept the task from one collaborator account, add a file and mention another participant in a comment.
4. With lock-screen notifications enabled on the recipient phone, lock the phone and confirm the mention appears.
5. Complete a recurring delegated task and confirm the next occurrence has fresh pending assignments.
6. Export an `.ics` file, then copy the private subscription link and add it to a calendar application.
7. Confirm `/privacy` and `/terms` open while signed out.
8. Use a disposable test account to download its data and then delete the account. Confirm the account can no longer sign in.

Treat the calendar subscription URL like a password. Anyone who has it can read dated task titles and notes until the user rotates the token.

## 4. Deploy the web app

Push the verified `main` branch. Vercel will build the Vite app automatically with the existing public Supabase and Web Push environment variables.
