# v1.8 validation — 20 September 2026

## Passed

- `npm test`: all 10 unit tests passed. Coverage includes assignment permissions and transitions, comment eligibility, accepted-contact direction, v1.8 RPC names and arguments, public email invitations, idempotent comments, notification updates, pagination and account-isolated cache migration.
- `npm run test:browser`: all 22 mocked browser scenarios passed in one complete headless Microsoft Edge run.
  - Existing-account requests and invitations to unregistered email addresses.
  - Secure invitation claim, reusable-password setup and later sign-in recovery.
  - Contact acceptance, removal, active-assignment revocation and reconnection.
  - Owner **Assigned by me** filtering and assignment cancellation.
  - Assignee accept, decline, complete, comments and owner/assignee boundaries.
  - Offline responses and comments, visible queue state, reconnect flush and idempotent comment creation.
  - Activity history, realtime notification counts, mark-one and mark-all.
  - Realtime owner edits, revoked task removal and visible-tab reconciliation.
  - Account export with personal and collaboration data and no session credentials.
  - v1.4 editing, recurrence, quick capture, notes, search, checklists, attachments, pinning, theme, calendar and account isolation.
  - Mobile navigation, task editor sizing, safe-area actions, offline personal notes and dark-note contrast.
- `npm run build`: successful Vite production build and PWA service-worker generation.
- The migration preserves all legacy notification values and existing collaboration rows. Closing a relationship changes active assignments to `cancelled`; it does not delete task or discussion history.
- The frontend accepts only Supabase publishable/anon credentials. No service-role key is used.

## Not exercised against the live project

No live account credentials or migration access were supplied. The browser suite uses mocked Auth, REST, Storage and Realtime responses and never writes to the live database.

Run `DAYMARK_V1.8_COLLABORATION_CONTROLS.sql` in the existing project after the v1.7 migration and before deploying the frontend. Then follow `SUPABASE_V1.8_SETUP.md` with two test accounts and one unrelated account to confirm the live RLS and RPC grants.

The optional email worker was not changed. If used, its existing Resend sender, Vault secret and schedules should remain configured as described in `SUPABASE_V1.7_SETUP.md`.

## Preserved boundaries

- The task owner controls task content and can cancel access. Each assignee controls only their response, completion state and permitted comments.
- Removing a contact revokes active shared tasks in both directions. Owners keep their own tasks and discussion history; former assignees lose task, comment and profile visibility.
- Shared tasks do not enter an assignee's private task cache. Personal tasks and notes remain available offline.
- Queued collaboration actions remain account-scoped and idempotent.
- Data export deliberately excludes authentication sessions, access tokens and private service credentials.
- Existing v1.4 data and v1.5–v1.7 collaboration records are retained by the additive migration.

