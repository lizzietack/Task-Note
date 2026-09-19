# Move Daymark/JotRelay from Netlify to Vercel

Keep the current Netlify deployment online until the Vercel production deployment, custom domain, authentication redirects and email invitation flow have all been verified.

## 1. Import the GitHub repository

In Vercel, import `lizzietack/Task-Note` and use these settings:

- Framework preset: **Vite**
- Production branch: **main**
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install` or Vercel's default

The included `vercel.json` provides the SPA fallback needed for direct navigation and prevents stale service-worker and web-manifest responses.

## 2. Add environment variables

Copy the existing public Supabase values into Vercel for Production, Preview and Development:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not add a service-role key. Redeploy after saving the variables.

## 3. Test the Vercel preview URL

Before changing DNS, confirm that the generated `vercel.app` deployment can:

1. Sign in and sign out.
2. Create and edit a personal task and note.
3. Load Contacts, Assigned to me and Assigned by me.
4. Send and claim an email invitation.
5. Receive realtime task and comment updates in a second account.
6. Install or refresh the PWA without seeing an older cached release.

## 4. Connect the custom domain

Add both domains under Vercel project **Settings → Domains**:

- `getjotrelay.com` as the primary production domain
- `www.getjotrelay.com` redirected to `getjotrelay.com`

Use the exact DNS records Vercel displays for this project. When DNS is managed by the registrar, update the records there instead of using `vercel dns add`. Vercel provisions HTTPS after the records verify.

## 5. Update Supabase authentication URLs

In Supabase Dashboard → Authentication → URL Configuration:

- Set **Site URL** to `https://getjotrelay.com`
- Add `https://getjotrelay.com/**` as an allowed redirect URL
- Add `https://www.getjotrelay.com/**` while the `www` redirect is being tested
- Keep the old Netlify URL temporarily during the migration

If preview deployments need authentication, add Vercel's preview wildcard for the account or team slug shown by Vercel. Use an exact production URL rather than a wildcard for the Site URL.

If the optional v1.7 email-delivery worker is configured, change its `DAYMARK_SITE_URL` secret to `https://getjotrelay.com` and redeploy that Edge Function.

## 6. Cut over without downtime

After the custom domain shows a valid certificate, test sign-up confirmation, password reset and task invitation links on `getjotrelay.com`. Confirm two-account realtime collaboration. Only then disable the old Netlify deployment.

