# JotRelay v1.9 lock-screen notifications

This upgrade adds standards-based Web Push. It can wake the service worker and display an alert when JotRelay is closed or the phone is locked. It uses the existing notification records and does not require a service-role key.

## 1. Apply the additive migration

Run `DAYMARK_V1.9_WEB_PUSH_NOTIFICATIONS.sql` once in the Supabase SQL Editor after the v1.8 migration. It adds per-device push subscriptions, a private delivery queue, reminder scheduling, retry jobs and row-level security.

## 2. Create one VAPID key pair

Generate the pair once and keep the private key secret:

```sh
npx web-push generate-vapid-keys
```

Add the public key to Vercel as `VITE_WEB_PUSH_PUBLIC_KEY` for Production, Preview and Development. Redeploy the web app after saving it.

Add these Edge Function secrets in Supabase:

```text
VAPID_PUBLIC_KEY=<the same public key used by Vercel>
VAPID_PRIVATE_KEY=<private key; never place this in Vercel or the browser>
VAPID_SUBJECT=https://www.getjotrelay.com
DAYMARK_SITE_URL=https://www.getjotrelay.com
DAYMARK_DELIVERY_SECRET=<a long random value>
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied by Supabase. The worker deliberately uses the anon key with secret-checked RPC functions; it does not use `SUPABASE_SERVICE_ROLE_KEY`.

## 3. Store the worker address and matching secret in Vault

Run the following once, replacing the placeholder with the same random value used for `DAYMARK_DELIVERY_SECRET`:

```sql
select vault.create_secret(
  'https://fyaluzjncqrmtvfbyend.supabase.co',
  'daymark_project_url'
);

select vault.create_secret(
  '<same long random delivery secret>',
  'daymark_notification_worker_secret'
);
```

If either Vault name already exists from v1.7, update that secret instead of creating a duplicate. The value named `daymark_notification_worker_secret` must exactly match the Edge Function's `DAYMARK_DELIVERY_SECRET`.

## 4. Deploy the worker

Deploy `supabase/functions/daymark-deliver-notifications`. The committed `supabase/config.toml` keeps JWT verification off because scheduled database calls do not carry a user session; the function rejects every request without the separate delivery secret.

The migration invokes the worker as soon as a notification is queued and also schedules a once-per-minute retry. Task reminders are created on the server in the timezone saved under Profile & settings.

## 5. Enable it on each device

- Android: open JotRelay in Chrome or the installed web app, then use **Profile & settings → Notifications → Enable on this device**.
- iPhone/iPad: iOS 16.4 or later is required. Open JotRelay in Safari, choose **Share → Add to Home Screen**, launch the installed JotRelay app and enable notifications from Profile & settings.
- Allow notifications when the operating system asks. Each phone, tablet or computer creates its own subscription.

Test with two accounts: enable notifications for the recipient, lock the recipient's phone, then assign a task or add a comment from the other account. Tapping the alert should open JotRelay and navigate to the related item.
