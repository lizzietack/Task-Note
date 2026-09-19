# Daymark — Tasks & Notes v1.5.1

Updated from the supplied v1.4 project. Existing quick capture, recurrence, reminders, calendar, search, notes/checklists, pin/archive, file/image/audio attachments, voice recording, themes, PWA and private cloud sync remain available.

## What's new

### v1.5.1 mobile and account polish

- New task and note editors become full-screen panels on phones. Their fields scroll independently while Cancel and Save remain visible above the browser safe area.
- Form controls use a mobile-safe 16px font size so iPhone Safari does not zoom the page when a field receives focus.
- Dark-mode note colors and secondary text use stronger contrast for comfortable reading.
- The sidebar now shows the user's saved name instead of their email. New accounts can provide a full name during sign-up.
- Profile & settings contains display-name, email and password controls. Email changes use Supabase's confirmation flow.
- The appearance control is a labeled Light/Dark switch, and signing out is a clear text action inside Profile & settings.

### v1.5 collaboration

- Contacts: invite an existing Daymark user by exact email; accept or decline requests.
- Assign to: select an accepted contact in the task editor. Failed assignments preserve the saved task for retry.
- Assigned to me: pending, accepted, completed and past assignments; accept/decline/complete actions and lightweight comments.
- Notification bell: unread count across all notifications, latest 100 entries, navigation, mark one/all read.
- Realtime updates plus refresh on reconnect, returning to the tab and every 30 seconds while visible.
- Owners retain task editing/deletion. Assignees use the secure workflow functions. Shared tasks never enter personal sync or local storage. Account caches and delete queues are isolated.

Assignment completion and the owner's task checkbox remain separate, matching the existing migration. Recurring tasks create a private next occurrence. Comments are task-wide; accepted/completed participants can post. Collaboration needs connectivity; personal task/note editing remains offline-friendly.

## Existing Supabase project

**Do not rerun the v1.4 setup SQL to upgrade your installation.** The original SQL files are retained for reference. This version uses your already-installed collaboration tables, policies and functions without replacing them.

Required: profiles (including email), text task IDs, connections, task_assignments, task_comments, notifications, and the existing v1.4 tables/storage bucket. The client calls these exact functions:

| Function | Arguments |
| --- | --- |
| daymark_invite_contact | invitee_email |
| daymark_respond_contact | target_connection, response |
| daymark_assign_task | target_task (text), target_user |
| daymark_respond_assignment | target_assignment, response |
| daymark_complete_assignment | target_assignment |

Contact/assignment notifications come from those functions. Comments use the existing RLS-protected insert policy; no new comment-notification trigger is added. The schema permits one connection per pair and one assignment per task/contact, including past declined records, so the UI does not offer to resend those records. Each signed-in user updates only their own profile email because the v1.4 Auth trigger did not populate it.

Retain the supplied public `.env` connection, or configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.example`. No service-role key is used; secret/service-role keys are rejected by the frontend. Realtime requires the collaboration tables in your existing `supabase_realtime` publication. See [Supabase documentation](https://supabase.com/docs/guides/realtime/postgres-changes).

## Run and deploy

Use Node.js 22+ (validated with Node 24):

```sh
npm ci
npm test
npm run build
npm run dev
```

For Netlify, replace project files, retain your environment variables and deploy with build command `npm run build` and publish directory `dist`. The source ZIP excludes dependencies, Git history and old builds.

Run `npm run test:browser` for mocked Auth/REST/Realtime browser tests. These never change your live project. The suite defaults to installed Microsoft Edge; set `PLAYWRIGHT_CHANNEL=chrome` for Chrome, or `PLAYWRIGHT_CHANNEL=chromium` after `npx playwright install chromium`.

The first account used after upgrade claims the old v1.4 device cache once; other accounts do not import it. Existing IDs are preserved; new items use UUID text IDs.

## Validation boundary

See `VALIDATION.md`. No live credentials were supplied: actual RLS, RPC grants, storage and two-account delivery require a live smoke check. With two accounts, invite/accept, assign, accept/comment/complete and check the owner's notification. Recheck attachments and reminders on deployed HTTPS. As in v1.4, browser reminders require Daymark to be running; closed-app delivery requires a push/native scheduling backend.
