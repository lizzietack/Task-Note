# JotRelay — Tasks & Notes v2.1

Updated from the supplied v1.4 project. Existing quick capture, recurrence, reminders, calendar, search, notes/checklists, pin/archive, file/image/audio attachments, voice recording, themes, PWA and private cloud sync remain available.

### v2.1 quiet collaboration and Google sign-in

- Realtime collaboration and the 30-second recovery check continue in the background. The dashboard status row appears only when JotRelay is offline, reconnecting, has queued work, or needs attention.
- The sign-in and sign-up screens include **Continue with Google** while retaining email and password access.
- New Google-authenticated profiles use the verified Google name and optional profile image.
- Run `JOTRELAY_V2.1_GOOGLE_AUTH.sql`, then follow `SUPABASE_V2.1_SETUP.md` to enable the Google provider without exposing its client secret.

## What's new

### v2.0 collaboration workspace

- Create shared task lists and add accepted contacts as members.
- Assign one task to several collaborators at once. Each person keeps an independent accept, decline and completion status.
- Upload private task files that the owner and permitted collaborators can open. Files are limited to 10 MB each.
- Mention task participants in comments. Mentions create targeted notifications and use the existing lock-screen Web Push delivery when the recipient enabled it.
- Recurring delegated tasks carry their active collaborators into the next occurrence as fresh assignments.
- Export an `.ics` calendar file or copy a private calendar subscription link for Apple Calendar, Google Calendar, Outlook and compatible apps.
- Download account data, permanently delete the account and stored files, and read the Privacy Policy or Terms of Service at `/privacy` and `/terms`.
- All collaboration permissions remain enforced in Supabase. The browser uses only the publishable key; no service-role key is included.

Before deploying v2.0, run `DAYMARK_V2.0_COLLABORATION_WORKSPACE.sql` once after the v1.9 migration, deploy `supabase/functions/jotrelay-calendar-feed` with JWT verification disabled, and follow `SUPABASE_V2_SETUP.md`.

### v2.0.1 collaborator attachment visibility

- Collaborator task details display owner-uploaded files and report attachment-loading errors with a retry action.
- The PWA checks for a fresh service worker whenever it starts or returns to the foreground, then reloads when an update takes control.
- Vercel revalidates the app shell and service-worker registration files so mobile browsers receive new releases promptly.

### v1.9 lock-screen notifications

- Standards-based Web Push can display assignment, comment, contact and reminder alerts while JotRelay is closed or the phone is locked.
- Each device has its own revocable subscription protected by row-level security. Expired browser subscriptions are removed automatically.
- The service worker opens the related JotRelay notification when an alert is tapped and avoids duplicate foreground notifications.
- Supabase schedules reminders in the user's timezone and sends queued pushes through a secret-checked Edge Function using the publishable/anon key, never a service-role key.
- iPhone and iPad support requires iOS/iPadOS 16.4 or later and JotRelay installed with **Add to Home Screen**. Android works from a supported browser or installed web app.

Before deploying v1.9, run `DAYMARK_V1.9_WEB_PUSH_NOTIFICATIONS.sql` once after the v1.8 migration and follow `SUPABASE_V1.9_SETUP.md`.

### v1.8.1 JotRelay brand refresh

- The app, browser title, installable-app metadata, reminders, authentication, settings and collaboration copy now use the JotRelay name.
- Existing `daymark_*` database functions, storage buckets, cache keys and invitation parameters remain unchanged so current accounts and synced data continue working.

### v1.8 collaboration control and data ownership

- **Assigned by me** gives task owners one place to review sent work by status, open the original task and cancel an active assignment.
- Removing an accepted contact immediately cancels active assignments in both directions. The former contact loses shared-task, comment and profile access while each owner keeps their task and discussion history.
- A cancelled or declined relationship can be reconnected through a new contact request. A completed, declined or cancelled assignment can be sent again without creating a duplicate record.
- Contact requests that are still pending can be cancelled by their sender.
- **Download my data** exports the signed-in user's JotRelay content and collaboration history as JSON without authentication tokens or private service credentials.
- Permission-aware controls, activity events and notifications explain assignment cancellation and contact removal to both people.

Before deploying v1.8, run `DAYMARK_V1.8_COLLABORATION_CONTROLS.sql` once after the v1.7 migration and follow `SUPABASE_V1.8_SETUP.md`.

### v1.7 reliable delivery

- Every shared task has a permission-aware Activity timeline for assignment, response, comment, owner-edit and completion events.
- Assignees can accept, decline, complete and comment while offline. JotRelay stores the action in a per-account outbox, shows its pending state and retries after reconnecting. Comment requests carry a unique nonce so a lost response cannot create duplicates.
- Email invitations can be resent, cancelled and reviewed in invitation history. Resending creates a fresh secure token and invalidates the earlier link.
- Profile & settings now includes an IANA timezone and separate preferences for contacts, assignments, comments, reminders, browser notifications and optional email fallback.
- Scheduled reminders are generated in the user's timezone and deduplicated in the database. An optional Resend worker processes private email-delivery jobs without a service-role key and uses provider idempotency keys for safe retries.
- New comments and owner task edits generate realtime notifications for active participants, subject to each recipient's preferences.
- GitHub Actions verifies unit tests, the production build and browser tests on every pull request and main-branch update.

Before deploying v1.7, run `DAYMARK_V1.7_RELIABLE_DELIVERY.sql` once and follow `SUPABASE_V1.7_SETUP.md`. The email worker is optional; all other v1.7 features work after the migration.

### v1.6.1 durable invited accounts

- A person joining from an email invitation must create an eight-character-or-longer password before the JotRelay dashboard becomes available.
- The invitation is claimed securely while password setup is displayed, so closing the tab does not detach the assigned task from the new account.
- The sign-in screen includes **Forgot or never created a password?** for recipients who joined through an earlier invitation and need permanent access to their account.
- Quick Capture now uses explicit **Task** and **Note** choices. The unused Auto option and sparkle icon have been removed.

### v1.6 open invitations and personal profiles

- Invite any email address. Existing JotRelay users receive an in-app contact request; a new user receives a secure Supabase magic link and is automatically connected after joining with the invited email.
- Invite an unregistered person directly from the task editor. The invitation stays attached to that task; after joining, the recipient can accept, decline, comment and complete it through the existing permission-aware workflow.
- Email invitation tokens are random, stored only as hashes, expire after 24 hours and can be claimed only by the matching authenticated email.
- Optional profile photos appear in the sidebar, settings and collaboration views. Images are limited to 5 MB and only the owner can upload, replace or remove them.
- The mobile navigation closes when the user taps outside it. Today now uses a calendar-check icon, and Capture first uses a notebook-and-pen icon.
- Realtime refresh, reconnect recovery and the 30-second visible-tab reconciliation remain active for cross-device and cross-location collaboration.

Before deploying v1.6, run `DAYMARK_V1.6_EMAIL_INVITES_AND_AVATARS.sql` once in Supabase SQL Editor and complete `SUPABASE_V1.6_SETUP.md`. Custom SMTP is required for production delivery to arbitrary email addresses.

### v1.5.1 mobile and account polish

- New task and note editors become full-screen panels on phones. Their fields scroll independently while Cancel and Save remain visible above the browser safe area.
- Form controls use a mobile-safe 16px font size so iPhone Safari does not zoom the page when a field receives focus.
- Dark-mode note colors and secondary text use stronger contrast for comfortable reading.
- The sidebar now shows the user's saved name instead of their email. New accounts can provide a full name during sign-up.
- Profile & settings contains display-name, email and password controls. Email changes use Supabase's confirmation flow.
- The appearance control is a labeled Light/Dark switch, and signing out is a clear text action inside Profile & settings.

### v1.5 collaboration

- Contacts: invite an existing JotRelay user by exact email; accept or decline requests.
- Assign to: select an accepted contact in the task editor. Failed assignments preserve the saved task for retry.
- Assigned to me: pending, accepted, completed and past assignments; accept/decline/complete actions and lightweight comments.
- Notification bell: unread count across all notifications, latest 100 entries, navigation, mark one/all read.
- Realtime updates plus refresh on reconnect, returning to the tab and every 30 seconds while visible.
- Owners retain task editing/deletion. Assignees use the secure workflow functions. Shared tasks never enter personal sync or local storage. Account caches and delete queues are isolated.

Assignment completion and the owner's task checkbox remain separate. Recurring tasks create a private next occurrence. Comments are task-wide; accepted/completed participants can post. Personal data remains offline-friendly, and supported collaboration actions now queue safely while offline.

## Existing Supabase project

**Do not rerun the v1.4 setup SQL to upgrade your installation.** For an existing v1.9 installation, run only the additive v2.0 migration. A new installation must apply the migrations in version order.

Required: profiles (including email and avatar_url), text task IDs, connections, task_assignments, task_comments, notifications, daymark_email_invites, and the existing v1.4 tables/storage bucket. The client calls these exact functions:

| Function | Arguments |
| --- | --- |
| daymark_invite_or_reconnect_contact | invitee_email |
| daymark_respond_contact | target_connection, response |
| daymark_close_connection | target_connection |
| daymark_assign_or_reactivate_task | target_task (text), target_user |
| daymark_cancel_assignment | target_assignment |
| daymark_respond_assignment | target_assignment, response |
| daymark_complete_assignment | target_assignment |
| daymark_create_email_invite | invitee_email, target_task |
| daymark_cancel_email_invite | target_invite |
| daymark_claim_email_invite | invite_token |
| daymark_add_task_comment | target_task, comment_body, request_nonce |
| daymark_add_task_comment_v2 | target_task, comment_body, request_nonce, mentioned_users |
| daymark_set_task_collaborators | target_task, target_users, target_list |
| daymark_save_shared_list | target_list, list_name, member_ids, list_color |
| daymark_delete_shared_list | target_list |
| daymark_get_calendar_token | rotate |
| daymark_calendar_feed | feed_token; server feed only |
| daymark_delete_account | confirm_text |
| daymark_set_assignment_status | target_assignment, target_status |
| daymark_queue_due_reminders | none; scheduled database job |
| daymark_claim_notification_deliveries | worker_secret, batch_limit |
| daymark_finish_notification_delivery | worker_secret, delivery result fields |
| daymark_claim_push_deliveries | worker_secret, batch_limit |
| daymark_finish_push_delivery | worker_secret, delivery result fields |
| daymark_invoke_delivery_worker | none; scheduled internal call |

Contact and assignment notifications come from the installed functions. v1.8 adds owner cancellation, safe contact removal, reconnection and assignment reactivation. v1.7 provides comment/task-update triggers, notification preferences and an email-delivery queue. Email invitation links are sent by Supabase Auth with `signInWithOtp`; the frontend contains only the publishable key. Each signed-in user updates only their own profile email and timezone.

Retain the supplied public `.env` connection, or configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.example`. v1.9 also uses the public `VITE_WEB_PUSH_PUBLIC_KEY`. No service-role key is used; secret/service-role keys are rejected by the frontend. Realtime requires the collaboration tables in your existing `supabase_realtime` publication. See [Supabase documentation](https://supabase.com/docs/guides/realtime/postgres-changes).

## Run and deploy

Use Node.js 20+ (validated locally with Node 24 and in GitHub Actions with Node 20):

```sh
npm ci
npm test
npm run build
npm run dev
```

For Vercel, import the GitHub repository, retain `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, and deploy the `main` branch. Vercel detects Vite; the committed `vercel.json` sets the production build, `dist` output, SPA fallback and PWA cache headers. Follow `VERCEL_MIGRATION.md` for the custom-domain and Supabase Auth cutover.

Run `npm run test:browser` for mocked Auth/REST/Realtime browser tests. These never change your live project. The suite defaults to installed Microsoft Edge; set `PLAYWRIGHT_CHANNEL=chrome` for Chrome, or `PLAYWRIGHT_CHANNEL=chromium` after `npx playwright install chromium`.

The first account used after upgrade claims the old v1.4 device cache once; other accounts do not import it. Existing IDs are preserved; new items use UUID text IDs.

## Validation boundary

See `VALIDATION.md`. Live RLS, RPC grants, storage and two-account delivery require a live smoke check. With two accounts, enable Web Push on the recipient's device, lock its screen, then test assignment, comment and reminder delivery. Operating systems may delay notifications because of Focus, Do Not Disturb, battery or network policies.
