# Daymark v1.7 reliable delivery setup

The core v1.7 application needs one additive migration. Email fallback is optional and can be enabled later without another frontend deployment.

## 1. Apply the v1.7 migration

Open Supabase Dashboard → SQL Editor, paste the complete contents of `DAYMARK_V1.7_RELIABLE_DELIVERY.sql`, and run it once.

The migration adds:

- task activity history;
- notification preferences and timezone-aware reminder generation;
- idempotent collaboration commands for offline retry;
- comment and task-update notifications;
- a private email-delivery queue;
- worker functions protected by a dedicated secret.

The migration is additive and does not delete existing Daymark data.

## 2. Test the core release

Deploy the frontend after the migration succeeds. Use two accounts to confirm:

1. An assignee can accept, comment and complete while online.
2. A comment or response made while offline appears as queued and synchronizes after reconnecting.
3. Both participants see the Activity timeline.
4. Invitation Resend invalidates the earlier link and delivers a fresh link.
5. Profile & settings saves notification preferences and the user's IANA timezone, such as `Africa/Accra`.

## 3. Optional email fallback

Daymark keeps email copies off for every user until the delivery worker is configured. The worker uses the Supabase publishable key plus a private worker secret. It does not use a service-role key. Each provider request includes the delivery ID as an idempotency key so a retry within the provider's retention window does not send the same message twice.

You need a verified sender in Resend and the Supabase CLI.

Generate a long random worker secret. Store the same value in Supabase Vault:

```sql
select vault.create_secret(
  'REPLACE_WITH_A_LONG_RANDOM_SECRET',
  'daymark_notification_worker_secret'
);
```

From the project directory, link the Supabase project and set the Edge Function secrets:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set DAYMARK_DELIVERY_SECRET="REPLACE_WITH_THE_SAME_SECRET"
supabase secrets set RESEND_API_KEY="YOUR_RESEND_API_KEY"
supabase secrets set DAYMARK_FROM_EMAIL="Daymark <notifications@your-domain.com>"
supabase secrets set DAYMARK_SITE_URL="https://daymark-task.netlify.app"
supabase functions deploy daymark-deliver-notifications --no-verify-jwt
```

In Supabase Dashboard → Integrations → Cron, create two jobs:

- Every five minutes, run SQL: `select public.daymark_queue_due_reminders();`
- Every minute, send a POST request to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/daymark-deliver-notifications` with header `x-daymark-delivery-secret` set to the worker secret.

After the worker test succeeds, users can enable **Email copies (useful when Daymark is closed)** in Profile & settings.

## 4. Delivery test

Enable email fallback for one test account, assign it a task from another account, and run the delivery worker. Confirm the email arrives once. Repeat with a comment and a due reminder. Check `notification_deliveries` in Table Editor for `sent`, `pending`, or `failed` status and retry details.

Keep the worker secret and Resend key only in Supabase. Do not put them in the React project, GitHub, Netlify `VITE_` variables, or browser storage.
