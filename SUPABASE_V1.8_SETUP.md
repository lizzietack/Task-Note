# Daymark v1.8 collaboration controls setup

Daymark v1.8 needs one additive Supabase migration before the updated frontend is deployed. It keeps existing tasks, contacts, assignments, comments, notifications and v1.7 delivery settings.

## 1. Apply the migration

Open Supabase Dashboard → SQL Editor, paste the complete contents of `DAYMARK_V1.8_COLLABORATION_CONTROLS.sql`, and run it once.

Run it only after the earlier Daymark collaboration, v1.6 and v1.7 migrations. A successful run reports **Success. No rows returned**.

The migration adds:

- safe contact-request cancellation and accepted-contact removal;
- immediate cancellation of active assignments between removed contacts;
- owner assignment cancellation;
- reconnection after a relationship was declined or removed;
- reassignment after an assignment was completed, declined or cancelled;
- cancellation activity and notification events;
- tighter comment and profile visibility after access is revoked.

No table or user data is deleted, and no service-role key is required.

## 2. Deploy the frontend

After the SQL succeeds, replace the files in the root of the existing Git/Netlify project with the v1.8 package contents. Keep the existing `.env` file or Netlify environment variables.

Commit and push the root project. Netlify should build with `npm run build` and publish `dist`.

## 3. Live permission check

Use two test accounts that are accepted contacts:

1. Account A assigns a task to Account B.
2. Account B accepts it and adds a comment.
3. Account A opens **Assigned by me** and cancels the assignment. Confirm Account B can no longer open the shared task or its comments.
4. Assign another task, then remove the contact. Confirm every active assignment between the accounts is cancelled and both users retain only the data they own.
5. Send a new contact request, accept it, and assign the task again.
6. In Profile & settings, use **Download my data** and confirm a JSON file is downloaded without sign-in tokens.

Use a third unrelated account to confirm it cannot read either person's profiles, assignments, comments or tasks.

## 4. Existing v1.7 email delivery

The optional v1.7 notification worker continues to work unchanged. If it is already configured, no new worker deployment or secret is needed. If it is not configured, all core v1.8 collaboration features still work; only optional email copies while Daymark is closed remain unavailable.

