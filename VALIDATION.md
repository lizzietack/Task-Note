# v1.6 validation — 19 September 2026

## Passed

- `npm test`: 10 tests. Role/status permissions, comment eligibility and validation, accepted contacts, exact installed RPC contracts, secure magic-link invitation routing, error propagation, notification recipient scoping, pagination and per-account legacy-cache migration.
- `npm run test:browser`: 16 tests in headless Microsoft Edge. Existing Supabase client runs against mocked Auth, REST, Storage and WebSocket responses; no live database writes.
  - Invite an existing account in-app, email an unregistered address, accept/decline contacts and restrict assignment choices.
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
  - Existing-user contact requests and unregistered-user email invitations.
  - Task invitations tied to an email, secure claim on sign-in, and resulting pending assignment.
  - Optional profile-photo upload and display.
  - Mobile outside-tap navigation closing and the replacement Today/Capture icons.
- `npm run build`: successful Vite production build and PWA service-worker generation.
- Mobile task editor, Profile & settings and dark colored-note screenshots visually inspected.
- Supplied environment checked locally: only Supabase URL and a verified public key. No service-role key used.

## Not exercised against the live project

No account credentials were supplied. Mock tests verify client behavior, not the live database's RLS policies, function grants, actual realtime publication, SMTP delivery, storage upload or real microphone capture. The additive v1.6 migration was reviewed but not applied to the live Supabase project.

Before deploying broadly, use two real accounts to invite/accept, assign, accept/comment/complete, and confirm the owner's notification and status. Confirm a third, unrelated account cannot read or mutate those records. Check attachments and reminders on the deployed HTTPS site.

For public email invitations, configure a production SMTP provider and allow the production Netlify URL in Supabase Auth redirect URLs. Test an invitation to an address outside the Supabase organization before announcing the feature.

## Preserved boundaries

- Owner task completion and individual assignment completion are separate in the installed migration.
- Comments are inserted under the existing task-participant RLS policy and update live. No additional comment-notification trigger is installed.
- Existing contact and assignment uniqueness constraints remain enforced. A newly claimed email invitation safely reactivates its matching task assignment as pending.
- Browser reminders still require the app to be running. Collaboration requires connectivity; personal tasks and notes retain local editing.
- Existing v1.4 device data is claimed once by the first account after upgrade; later accounts have separate caches and delete queues. Legacy data is not deleted.
