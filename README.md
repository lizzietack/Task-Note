# Daymark — Tasks & Notes v1.4

Daymark is a calm, offline-friendly everyday task and notes organizer built with React, Vite and Supabase.

## What v1.4 adds

- Supabase email/password authentication with persistent sessions
- Private per-user cloud data protected by Row Level Security
- Cross-device task and note synchronization
- Realtime refresh when another signed-in device changes tasks or notes
- Private Supabase Storage uploads for note images, files and voice recordings
- Local cache remains the immediate UI source, so ordinary task/note work remains responsive when connectivity drops
- Delete tombstones so a stale offline device does not simply resurrect a task/note deleted on another device
- Existing v1.3 local data is merged into the signed-in account on first connection
- Visible sync state and manual sync control
- Future import/source metadata is preserved without exposing unfinished email UI

## 1. Create the Supabase schema

Open your Supabase project and go to **SQL Editor -> New query**. Paste the complete contents of:

`DAYMARK_SUPABASE_SETUP.sql`

Run it once. It creates the Daymark tables, RLS policies, private storage bucket, profile trigger and realtime publication entries.

No service-role key is required by the app.

## 2. Configure authentication

In **Supabase -> Authentication -> Providers -> Email**, keep Email enabled.

For production, configure your Site URL and Redirect URLs under **Authentication -> URL Configuration** to your deployed HTTPS Daymark domain. Email confirmation can remain enabled; new users will then be asked to confirm their email before their first session.

## 3. Environment

This package includes the supplied public project connection in `.env`. For another environment use:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Only the Supabase publishable key belongs in the frontend. Never put a service-role key or database password in Vite/browser environment variables.

## 4. Run locally

```bash
npm install
npm run dev
```

Open the localhost URL Vite prints. Create/sign in to a Daymark account. Existing v1.3 local tasks/notes in the same browser are merged into the account.

## 5. Production build

```bash
npm run build
npm run preview
```

Deploy `dist/` through HTTPS (for example Vercel/Netlify). HTTPS is required for reliable PWA installation and microphone permissions outside localhost.

## Sync model

Daymark writes task/note changes to the local cache immediately, then syncs them to Supabase when signed in and online. Offline edits remain locally available and retry when connectivity returns. Deletes are queued as tombstones. Attachments created locally keep their preview until uploaded; signed cloud attachment URLs require connectivity to refresh after they expire.

## Current reminder boundary

Browser reminders can fire while Daymark is running and notifications are permitted. Guaranteed reminders while the application is fully closed require native scheduled notifications (Capacitor Android/iOS) or a push backend. That is the next mobile layer, not something this web build pretends to provide.
