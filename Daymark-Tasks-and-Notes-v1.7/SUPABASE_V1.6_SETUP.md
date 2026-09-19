# Daymark v1.6–v1.6.1 Supabase setup

Complete these steps before deploying the email-invitation release to Netlify. The v1.6.1 password-setup improvement uses the same v1.6 database migration; no additional SQL is required.

## 1. Add the database changes

Open Supabase Dashboard → SQL Editor, paste the complete contents of `DAYMARK_V1.6_EMAIL_INVITES_AND_AVATARS.sql`, and run it once. It adds the hashed email-invitation flow, the `avatar_url` profile field, and the `daymark-avatars` storage bucket and policies.

## 2. Allow the Daymark return URL

Open Authentication → URL Configuration.

- Site URL: `https://daymark-task.netlify.app`
- Redirect URL: `https://daymark-task.netlify.app/**`

Keep any localhost or Netlify preview URLs you already use. Supabase accepts a magic-link return only when its destination is on this allow list.

Open Authentication → Sign In / Providers → Email and set **Email OTP expiration** to `86400` seconds so the Supabase magic link and Daymark's 24-hour invitation window match.

## 3. Configure production email delivery

Open Authentication → Emails → SMTP Settings and configure a custom SMTP provider. Supabase's default sender is intended for testing and will not deliver invitations reliably to arbitrary public addresses. Resend, Postmark, Amazon SES, SendGrid, ZeptoMail and Brevo are compatible choices.

Do not add SMTP credentials or a service-role key to the React project or Netlify `VITE_` variables. Store SMTP credentials only in Supabase's SMTP settings.

Disable click tracking or link rewriting for authentication emails in your SMTP provider. A rewritten or automatically opened single-use link can prevent the recipient from completing sign-in.

## 4. Brand the invitation message

Open Authentication → Email Templates → Magic Link. Suggested subject:

`You have been invited to Daymark`

Suggested body:

```html
<h2>A Daymark invitation is waiting for you</h2>
{{ if .Data.task_title }}
<p>You have been invited to collaborate on: <strong>{{ .Data.task_title }}</strong></p>
{{ else }}
<p>Someone has invited you to connect and collaborate on Daymark.</p>
{{ end }}
<p><a href="{{ .ConfirmationURL }}">Open Daymark</a></p>
<p>This secure link verifies your invited email. Daymark will then ask you to create a password for future visits.</p>
```

Keep `{{ .ConfirmationURL }}` exactly as shown so Supabase can authenticate the recipient and return them to the invitation.

## 5. Smoke test

Invite an email address that is not already registered and is outside your Supabase organization. Open the email on another phone or computer. Confirm that Daymark requires a new password before opening the dashboard, opens Assigned to me after password creation, and lets the recipient accept or decline the task. Close the tab, reopen Daymark, and sign in with the invited email and new password. Then verify comments, completion and owner notifications in both directions.

Someone who accepted a v1.6 invitation before creating a password can recover access from the Daymark sign-in screen: enter the invited email, select **Forgot or never created a password?**, open the recovery email, and create a reusable password.
