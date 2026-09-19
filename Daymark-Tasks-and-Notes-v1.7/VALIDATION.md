# v1.7 validation — 19 September 2026

## Passed

- `npm test`: all 10 unit tests passed. These cover assignment permissions and transitions, comment eligibility and validation, accepted-contact direction, exact RPC arguments, failure propagation, public email invitations, idempotent comment nonces, recipient-scoped notification updates, pagination and per-account cache migration.
- `npm run test:browser`: all 19 mocked browser scenarios passed in one complete headless Microsoft Edge run.
  - Existing-account requests and invitations to unregistered email addresses.
  - Secure invitation claim, required reusable-password setup and later sign-in recovery.
  - Task assignment, accept, decline, complete, comments and owner/assignee boundaries.
  - Offline assignment responses and comments, visible queue state, reconnect flush and single comment creation.
  - Activity history for assignment, comments and completion.
  - Realtime notification counts beyond the 100-item display limit, mark-one and mark-all.
  - Realtime owner edits, access revocation and 30-second reconciliation behavior.
  - Invitation resend, cancellation controls and history.
  - Timezone and notification-preference updates in Profile & settings.
  - v1.4 editing, recurrence, quick capture, notes, search, checklists, attachments, pinning, theme, calendar and account isolation.
  - Mobile navigation, task editor sizing, safe-area actions, offline personal notes and dark-note contrast.
- `npm run build`: successful Vite production build and PWA service-worker generation.
- Mobile Assigned to me, Profile & settings, task editor, sidebar, invitation-password setup and dark-note captures were inspected. The desktop Contacts view was also inspected in dark mode.
- The v1.7 migration retains all legacy v1.5 notification event values, backfills baseline activity for existing assignments and adds the new event values without replacing user data.
- The frontend accepts only Supabase publishable/anon credentials. The optional delivery worker uses a dedicated Vault-backed secret and the Supabase anon key; no service-role key is used. Resend requests include a stable delivery idempotency key.

## Not exercised against the live project

No live account credentials, migration access, Resend account or production SMTP credentials were supplied. The browser suite uses mocked Auth, REST, Storage and Realtime responses and never writes to the live database.

Run `DAYMARK_V1.7_RELIABLE_DELIVERY.sql` in the existing project before deploying the frontend. Then use two real accounts to confirm invite/accept, assignment, offline response/comment recovery, Activity and notifications. Use a third unrelated account to verify that RLS prevents access.

The optional email worker still needs a verified Resend sender, a Vault secret, Edge Function deployment and the two schedules described in `SUPABASE_V1.7_SETUP.md`. Confirm one assignment, one comment and one due reminder reaches a real mailbox only once.

## Preserved boundaries

- The task owner controls task content and its checkbox. Each assignee controls only their assignment response and completion state.
- Shared tasks do not enter an assignee's private task cache. Personal tasks and notes remain available offline.
- Queued collaboration actions are stored per account. Comment retries reuse their nonce, and assignment-state retries are idempotent.
- Notification preferences gate new in-app and email events. Browser notifications require the app to be running; email copies require the optional worker.
- Existing v1.4 data and v1.5/v1.6 collaboration records are retained by the additive migration.
