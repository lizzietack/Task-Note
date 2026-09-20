# JotRelay v2.1 Google sign-in

1. Run `JOTRELAY_V2.1_GOOGLE_AUTH.sql` once in the existing Supabase SQL Editor. This lets new Google users receive their Google name and optional photo in their JotRelay profile.
2. In Google Cloud, create a **Web application** OAuth 2.0 client.
3. Add this authorized redirect URI to that Google client:

   `https://fyaluzjncqrmtvfbyend.supabase.co/auth/v1/callback`

4. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the client ID and client secret.
5. Keep **Skip nonce checks** and **Allow users without an email** disabled, then save.
6. In Supabase **Authentication → URL Configuration**, use `https://www.getjotrelay.com` as the Site URL and allow `https://www.getjotrelay.com/**` as a redirect URL.
7. Open a private browser window and confirm that **Continue with Google** creates or signs into the expected account and returns to JotRelay.

Never place the Google client secret in the frontend or a `VITE_` environment variable. It belongs only in Supabase’s Google provider configuration.
