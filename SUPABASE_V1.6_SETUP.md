# Daymark v1.6 Supabase setup

Complete these steps before pushing v1.6 to Netlify.

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
<p>This secure link signs you in with the invited email address.</p>
```

Keep `{{ .ConfirmationURL }}` exactly as shown so Supabase can authenticate the recipient and return them to the invitation.

## 5. Smoke test

Invite an email address that is not already registered and is outside your Supabase organization. Open the email on another phone or computer. Confirm that the link signs the recipient in, opens Assigned to me, and lets them accept or decline the task. Then verify comments, completion and owner notifications in both directions.
