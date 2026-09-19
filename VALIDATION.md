# v1.5.1 validation — 19 September 2026

## Passed

- `npm test`: 9 tests. Role/status permissions, comment eligibility and validation, accepted contacts, exact installed RPC contracts, error propagation, notification recipient scoping, pagination and per-account legacy-cache migration.
- `npm run test:browser`: 13 tests in headless Microsoft Edge. Existing Supabase client runs against mocked Auth, REST and WebSocket responses; no live database writes.
  - Invite an existing account, surface unknown-email errors, accept/decline contacts and restrict assignment choices.
  - Save/assign a task; recover from assignment failure without duplicating the saved task.
  - Assignee accept/comment/complete with no owner editing and no shared-task personal-cache writes.
  - Realtime notification delivery, 105 unread vs 100 displayed, mark one/all read.
  - Realtime revocation removes previously visible task details; decline prevents further workflow actions/comment entry.
  - v1.4 editing, weekly recurrence, quick-note capture, search and account-switch isolation.
  - Mobile layout and offline personal-note capture with collaboration actions disabled.
  - Realtime owner task updates without repeated write echoes.
  - Note checklists, local file attachments, pinning, theme and calendar controls; voice-recording control remains available.
- Mobile task-editor height, width, scrolling, safe-area actions, 16px controls and iPhone zoom prevention.
- Display-name, email and password updates through Profile & settings, including the professional sign-out action.
- WCAG AA contrast checks for dark-mode colored note titles and body text.
- `npm run build`: successful Vite production build and PWA service-worker generation.
- Mobile task editor, Profile & settings and dark colored-note screenshots visually inspected.
- Supplied environment checked locally: only Supabase URL and a verified public key. No service-role key used.

## Not exercised against the live project

No account credentials were supplied. Mock tests verify client behavior, not the live database's RLS policies, function grants, actual realtime publication, server-generated notifications, storage upload or real microphone capture. The supplied v1.4 SQL and already-created collaboration schema were not changed or applied.

Before deploying broadly, use two real accounts to invite/accept, assign, accept/comment/complete, and confirm the owner's notification and status. Confirm a third, unrelated account cannot read or mutate those records. Check attachments and reminders on the deployed HTTPS site.

## Preserved boundaries

- Owner task completion and individual assignment completion are separate in the installed migration.
- Comments are inserted under the existing task-participant RLS policy and update live. No additional comment-notification trigger is installed.
- Existing uniqueness constraints prevent reinviting the same pair or reassigning the same task/contact after decline; those options are not offered.
- Browser reminders still require the app to be running. Collaboration requires connectivity; personal tasks and notes retain local editing.
- Existing v1.4 device data is claimed once by the first account after upgrade; later accounts have separate caches and delete queues. Legacy data is not deleted.
