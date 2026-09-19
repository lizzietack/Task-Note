import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { setup, ME, OTHER, THIRD } from './fixtures';

test('contacts accept requests and invite both existing and new users by email', async ({ page }) => {
  const { db, calls, errors } = await setup(page);
  await page.getByRole('button', { name:'Contacts', exact:false }).click();
  await page.getByRole('button', { name:'Accept', exact:true }).click();
  expect(db.connections.find(c=>c.id==='c2').status).toBe('accepted');
  await page.getByLabel('Invite someone by email').fill('missing@example.com');
  await page.getByRole('button',{name:'Send invitation'}).click();
  await expect(page.getByText('Invitation email sent.',{exact:false})).toBeVisible();
  expect(db.daymark_email_invites.find(invite=>invite.invitee_email==='missing@example.com')).toBeTruthy();
  expect(calls.some(call=>call.path.endsWith('/auth/v1/otp')&&call.body?.email==='missing@example.com')).toBe(true);
  await page.getByRole('button',{name:'Resend',exact:true}).click();
  await expect(page.getByText('A fresh invitation was sent',{exact:false})).toBeVisible();
  expect(calls.filter(call=>call.path.endsWith('/auth/v1/otp')&&call.body?.email==='missing@example.com')).toHaveLength(2);
  db.profiles.push({ id:'44444444-4444-4444-8444-444444444444', display_name:'New colleague',email:'new@example.com' });
  await page.getByLabel('Invite someone by email').fill('new@example.com');
  await page.getByRole('button',{name:'Send invitation'}).click();
  await expect(page.getByText('Contact request sent.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await expect(page.getByLabel('Assign to a contact').locator('option')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('owner creates and assigns once; failed assignment preserves the saved task for retry', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByLabel('Task',{exact:true}).fill('Prepare monthly report');
  await page.getByLabel('Assign to a contact').selectOption(OTHER);
  state.failNextAssignment();
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Task saved. Assignment was not confirmed');
  expect(state.db.tasks.filter(t=>t.title==='Prepare monthly report')).toHaveLength(1);
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.getByLabel('Task',{exact:true})).toHaveCount(0);
  expect(state.db.tasks.filter(t=>t.title==='Prepare monthly report')).toHaveLength(1);
  expect(state.db.task_assignments.filter(a=>a.id==='new-a')).toHaveLength(1);
  await page.getByRole('button',{name:'Prepare monthly report',exact:false}).click();
  await expect(page.getByText('You own this task')).toBeVisible();
  await expect(page.getByText('pending',{exact:true})).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('owner can manage sent work centrally and cancel active assignment access', async ({ page }) => {
  const state=await setup(page);
  await page.getByRole('button',{name:'Assigned by me',exact:false}).click();
  await expect(page.getByRole('heading',{name:'Assigned by me'})).toBeVisible();
  await expect(page.getByText('To Herbert',{exact:true})).toBeVisible();
  await expect(page.getByText('Review supplier payment',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.collab-meta').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
  await page.screenshot({path:'test-results/mobile-assigned-by-me-v18.png',fullPage:true});
  page.once('dialog', dialog=>dialog.accept());
  await page.getByRole('button',{name:'Cancel assignment',exact:true}).click();
  await expect(page.getByText('No sent assignments here',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancelled',exact:true}).click();
  await expect(page.getByText('Review supplier payment',{exact:true})).toBeVisible();
  expect(state.db.task_assignments.find(assignment=>assignment.id==='a2').status).toBe('cancelled');
  expect(state.db.task_activity.some(activity=>activity.assignment_id==='a2'&&activity.event_type==='cancelled'&&activity.actor_id===ME)).toBe(true);
  expect(state.db.notifications.some(notification=>notification.assignment_id==='a2'&&notification.type==='assignment_cancelled'&&notification.user_id===OTHER)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('removing a contact revokes active shared tasks and still allows a later reconnection request', async ({ page }) => {
  const state=await setup(page);
  await page.getByRole('button',{name:'Contacts',exact:false}).click();
  page.once('dialog', dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove contact',exact:true}).click();
  await expect(page.getByText('Contact removed. 2 active assignments were cancelled.',{exact:true})).toBeVisible();
  expect(state.db.connections.find(connection=>connection.id==='c1').status).toBe('cancelled');
  expect(state.db.task_assignments.filter(assignment=>assignment.id==='a1'||assignment.id==='a2').every(assignment=>assignment.status==='cancelled')).toBe(true);
  await page.getByLabel('Invite someone by email').fill('herbert@example.com');
  await page.getByRole('button',{name:'Send invitation'}).click();
  await expect(page.getByText('Contact request sent.',{exact:false})).toBeVisible();
  expect(state.db.connections.find(connection=>connection.id==='c1').status).toBe('pending');
  expect(state.db.connections.find(connection=>connection.id==='c1').requester_id).toBe(ME);
  expect(state.errors).toEqual([]);
});

test('owner can email a task to someone who has not joined JotRelay yet', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByLabel('Task',{exact:true}).fill('Confirm venue booking');
  await page.getByLabel('Invite by email').fill('remote@example.org');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.getByText('Invitation sent to remote@example.org',{exact:false})).toBeVisible();
  const invitation=state.db.daymark_email_invites.find(invite=>invite.invitee_email==='remote@example.org');
  expect(invitation?.task_id).toBeTruthy();
  expect(state.calls.some(call=>call.path.endsWith('/auth/v1/otp')&&call.body?.email==='remote@example.org')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('recipient claims an emailed task and can accept or decline it in real time', async ({ page }) => {
  const state = await setup(page);
  state.db.task_assignments = [];
  state.addEmailInvite({inviter_id:OTHER,invitee_email:'raphael@example.com',task_id:'shared-task',mock_token:'join-token'});
  await page.goto('/?daymark_invite=join-token');
  await expect(page.getByText('Invitation claimed.',{exact:false})).toBeVisible();
  await expect(page).toHaveURL(/^(?!.*daymark_invite)/);
  await expect(page.getByRole('button',{name:'Send payment receipt',exact:true})).toBeVisible();
  expect(state.db.connections.some(connection=>connection.status==='accepted'&&[connection.requester_id,connection.addressee_id].includes(OTHER)&&[connection.requester_id,connection.addressee_id].includes(ME))).toBe(true);
  expect(state.db.task_assignments.some(assignment=>assignment.task_id==='shared-task'&&assignment.assignee_id===ME&&assignment.status==='pending')).toBe(true);
  expect(state.errors).toEqual([]);
});

test('a new invited user must create a reusable password before opening JotRelay', async ({ page }) => {
  const state = await setup(page);
  state.db.task_assignments = [];
  state.addEmailInvite({inviter_id:OTHER,invitee_email:'raphael@example.com',task_id:'shared-task',mock_token:'new-user-token'});
  await page.evaluate(() => {
    const key='sb-daymark-test-auth-token';
    const saved=JSON.parse(localStorage.getItem(key));
    saved.user.user_metadata={...saved.user.user_metadata,daymark_invitation:true,daymark_password_created:false};
    localStorage.setItem(key,JSON.stringify(saved));
  });
  await page.goto('/?daymark_invite=new-user-token&daymark_setup=1');
  const setupDialog=page.getByRole('dialog',{name:'Create your JotRelay password'});
  await expect(setupDialog).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/mobile-invite-password-setup.png',animations:'disabled'});
  await expect.poll(()=>state.db.daymark_email_invites.find(invite=>invite.mock_token==='new-user-token')?.status).toBe('claimed');
  await setupDialog.getByLabel('New password').fill('return-to-daymark-123');
  await setupDialog.getByLabel('Confirm password').fill('return-to-daymark-123');
  await setupDialog.getByRole('button',{name:'Create password and open JotRelay'}).click();
  await expect(setupDialog).toHaveCount(0);
  await expect(page).toHaveURL(/^(?!.*daymark_(invite|setup))/);
  expect(state.calls.some(call=>call.path.endsWith('/auth/v1/user')&&call.body?.password==='return-to-daymark-123'&&call.body?.data?.daymark_password_created===true)).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog',{name:'Create your JotRelay password'})).toHaveCount(0);
  await page.locator('button.menu').click();
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await expect(page.getByRole('button',{name:'Send payment receipt',exact:true})).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('an earlier invitee can request a password link from the sign-in screen', async ({ page }) => {
  const state = await setup(page);
  await page.locator('.sidebar-profile').click();
  await page.getByRole('button',{name:'Sign out of JotRelay'}).click();
  await page.getByLabel('Email').fill('raphael@example.com');
  await page.getByRole('button',{name:'Forgot or never created a password?'}).click();
  await expect(page.getByText('Check your email for a secure link',{exact:false})).toBeVisible();
  const recovery=state.calls.find(call=>call.path.endsWith('/auth/v1/recover'));
  expect(recovery?.body?.email).toBe('raphael@example.com');
  expect(decodeURIComponent(recovery?.query||'')).toContain('daymark_password_reset=1');
  expect(state.errors).toEqual([]);
});

test('assignee can accept, comment, complete; no owner edits or personal-cache writes', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await expect(page.getByRole('button',{name:'Complete assignment'})).toHaveCount(0);
  await page.getByRole('button',{name:'Send payment receipt',exact:true}).click();
  await expect(page.getByLabel('Task',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button',{name:'Accept task'}).click();
  await expect(page.getByLabel('Add a comment')).toBeVisible();
  await page.getByLabel('Add a comment').fill('Receipt attached to our email.');
  await page.getByRole('button',{name:'Post comment'}).click();
  await expect(page.getByText('Receipt attached to our email.',{exact:true})).toBeVisible();
  await expect(page.getByText('added a comment.',{exact:false})).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'Complete assignment'}).click();
  await expect(page.getByRole('dialog').getByText('completed',{exact:true})).toBeVisible();
  await expect(page.getByText('completed the assignment.',{exact:false})).toBeVisible();
  expect(state.db.tasks.find(t=>t.id==='shared-task').completed).toBe(false);
  expect(state.calls.filter(c=>c.method==='POST' && c.path.endsWith('/tasks')).flatMap(c=>c.body).some(t=>t.id==='shared-task')).toBe(false);
  const cached = await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.tasks.v1`)),ME);
  expect(cached.some(t=>t.id==='shared-task')).toBe(false);
  expect(state.errors).toEqual([]);
});

test('offline comments queue once and synchronize idempotently after reconnecting', async ({ page }) => {
  const state=await setup(page);
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await page.getByRole('button',{name:'Send payment receipt',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Accept task'}).click();
  await expect(page.getByLabel('Add a comment')).toBeVisible();
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
  await page.getByLabel('Add a comment').fill('Queued update from the train.');
  await page.getByRole('button',{name:'Queue comment'}).click();
  await expect(page.getByText('Waiting to sync',{exact:true})).toBeVisible();
  expect(await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.collaboration-outbox.v1.${uid}`)||'[]').length,ME)).toBe(1);
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
  await expect.poll(()=>state.db.task_comments.filter(comment=>comment.body==='Queued update from the train.').length).toBe(1);
  await expect.poll(()=>page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.collaboration-outbox.v1.${uid}`)||'[]').length,ME)).toBe(0);
  expect(state.errors).toEqual([]);
});

test('realtime notification count includes unread beyond 100 and supports mark-read and mark-all', async ({ page }) => {
  const state = await setup(page);
  state.db.notifications.push(...Array.from({length:105},(_,i)=>({id:`n${i}`,user_id:ME,title:`Notification ${i}`,message:'A contact update',type:'contact_invite',connection_id:'c2',created_at:'2026-09-19T08:00:00Z',read_at:null})));
  state.emit('notifications');
  await expect(page.getByRole('button',{name:'Notifications, 105 unread'})).toBeVisible();
  await page.getByRole('button',{name:'Notifications, 105 unread'}).click();
  await expect(page.locator('.notification-panel article')).toHaveCount(100);
  await page.getByRole('button',{name:'Mark read',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Notifications, 104 unread'})).toBeVisible();
  await page.getByRole('button',{name:'Mark all read'}).click();
  await expect(page.getByRole('button',{name:'Notifications, 0 unread'})).toBeVisible();
  expect(state.db.notifications.every(n=>n.read_at)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('realtime changes remove revoked task details; declined assignments are read-only', async ({ page }) => {
  const state=await setup(page);
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await page.getByRole('button',{name:'Send payment receipt',exact:true}).click();
  state.db.task_assignments[0].status='cancelled'; state.emit('task_assignments');
  await expect(page.getByRole('dialog').getByText('Task details unavailable',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Accept task'})).toHaveCount(0);
  await expect(page.getByText('Please send the receipt after payment.',{exact:true})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('v1.4 task editing, recurrence, note capture, search and account separation remain available', async ({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'Review supplier payment',exact:false}).click();
  await page.getByLabel(/^Repeat/).selectOption('weekly');
  await page.getByRole('button',{name:'Save task',exact:true}).click();
  await page.locator('.task-row').filter({hasText:'Review supplier payment'}).locator('button.check').click();
  await expect.poll(()=>page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.tasks.v1`)).filter(t=>t.title==='Review supplier payment').length,ME)).toBe(2);
  await page.getByRole('button',{name:'Add',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'Auto',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Note',exact:true}).click();
  await page.getByPlaceholder(/^Try: Call Nana/).fill('Remember the meeting room code');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByText('the meeting room code',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('.search-large input').fill('meeting');
  await expect(page.getByText('the meeting room code',{exact:true})).toBeVisible();
  await page.locator('.sidebar-profile').click();
  await page.getByRole('button',{name:'Sign out of JotRelay'}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByLabel('Email').fill('herbert@example.com'); await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('.sidebar-profile')).toContainText('Herbert');
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByText('the meeting room code',{exact:true})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('mobile layout and offline collaboration preserve personal editing', async ({page})=>{
  const state=await setup(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator('button.menu').click();
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await expect.poll(async()=>{const box=await page.locator('aside.sidebar').boundingBox();return box.x+box.width;}).toBeLessThanOrEqual(0);
  await page.screenshot({path:'test-results/mobile-assigned.png',fullPage:true,animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
  await expect(page.getByRole('button',{name:'Accept task'})).toBeEnabled();
  await page.getByRole('button',{name:'Accept task'}).click();
  await expect(page.getByText('Accepted response queued for sync.',{exact:false})).toBeVisible();
  expect(await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.collaboration-outbox.v1.${uid}`)||'[]').length,ME)).toBe(1);
  await expect(page.getByText('collaboration change is safely queued',{exact:false})).toBeVisible();
  await page.locator('button.fab').click();
  await page.getByRole('button',{name:'Note',exact:true}).click();
  await page.getByPlaceholder(/^Try: Call Nana/).fill('Remember an offline note');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  expect(await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.notes.v1`)).some(n=>n.title==='an offline note'),ME)).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
  await expect.poll(()=>state.db.task_assignments[0].status).toBe('accepted');
  await expect.poll(()=>page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.collaboration-outbox.v1.${uid}`)||'[]').length,ME)).toBe(0);
  expect(state.errors).toEqual([]);
});

test('decline flows hide further responses and comment entry', async ({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Contacts',exact:false}).click();
  await page.getByRole('button',{name:'Decline',exact:true}).click();
  await expect(page.getByText('declined',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Assigned to me',exact:false}).click();
  await page.getByRole('button',{name:'Decline task',exact:true}).click();
  await page.getByRole('button',{name:'Declined',exact:true}).click();
  await expect(page.getByText('Task details unavailable',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Details & comments'}).click();
  await expect(page.getByLabel('Add a comment')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Accept task'})).toHaveCount(0);
  expect(state.db.task_assignments[0].status).toBe('declined');
  expect(state.errors).toEqual([]);
});

test('live owner edits refresh without repeated task upserts', async ({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  state.db.tasks[0].title='Updated from another device';
  state.db.tasks[0].updated_at='2027-01-01T00:00:00Z';
  state.emit('tasks');
  await expect(page.getByRole('button',{name:'Updated from another device',exact:false})).toBeVisible();
  // Observe two debounce windows: a remote-only edit should cause no write echo.
  await page.waitForTimeout(2200);
  expect(state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/tasks'))).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test('notes retain checklists, attachments, pinning, theme and calendar controls', async ({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Meeting checklist');
  await page.getByRole('button',{name:'Checklist',exact:true}).click();
  await page.getByPlaceholder('Add a checklist item').fill('Bring receipt');
  await page.getByRole('button',{name:'Add item',exact:true}).click();
  await page.locator('input[type="file"]').setInputFiles({name:'receipt.txt',mimeType:'text/plain',buffer:Buffer.from('Receipt details')});
  await expect(page.getByText('receipt.txt',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Record voice',exact:true})).toBeVisible();
  await page.getByLabel('Pin this note').check();
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.getByRole('button',{name:'Mark complete: Bring receipt',exact:true}).click();
  expect(await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.notes.v1`))[0].checklist[0].done,ME)).toBe(true);
  await page.getByRole('switch',{name:'Use dark mode'}).click();
  await expect(page.locator('.app')).toHaveClass('app dark');
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await expect(page.locator('.calendar-shell')).toBeVisible();
  await page.getByRole('button',{name:'Contacts',exact:false}).click();
  await page.screenshot({path:'test-results/desktop-contacts.png',fullPage:true});
  expect(state.errors).toEqual([]);
});

test('profile settings show the name, update identity and provide account security actions', async ({page})=>{
  const state=await setup(page);
  await expect(page.locator('.sidebar-profile')).toContainText('Raphael');
  await expect(page.locator('.sidebar-profile')).not.toContainText('raphael@example.com');
  await page.locator('.sidebar-profile').click();
  await expect(page.getByRole('dialog',{name:'Profile & settings'})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('raphael@example.com');
  await page.getByLabel('Name',{exact:true}).fill('Raphael McAdjei');
  await page.getByRole('button',{name:'Save name'}).click();
  await expect(page.locator('.settings-modal .inline-success')).toContainText('name has been updated');
  await page.getByRole('button',{name:'Close settings'}).click();
  await expect(page.locator('.sidebar-profile')).toContainText('Raphael McAdjei');
  await page.locator('.sidebar-profile').click();
  await page.getByLabel('Email',{exact:true}).fill('raphael.new@example.com');
  await page.getByRole('button',{name:'Update email'}).click();
  await expect(page.locator('.settings-modal .inline-success')).toContainText('Check your inbox');
  await page.getByLabel('New password').fill('new-password-123');
  await page.getByLabel('Confirm password').fill('new-password-123');
  await page.getByRole('button',{name:'Change password'}).click();
  await expect(page.locator('.settings-modal .inline-success')).toContainText('password has been changed');
  await expect(page.getByRole('button',{name:'Choose photo'})).toBeEnabled();
  await page.locator('.settings-modal input[type="file"]').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:Buffer.from('profile-image')});
  await expect(page.locator('.settings-modal .inline-success')).toContainText('profile photo has been updated');
  await expect(page.locator('.settings-modal .profile-avatar img')).toBeVisible();
  await page.getByLabel('Timezone').fill('Europe/London');
  await page.getByRole('button',{name:'Save timezone'}).click();
  await expect(page.locator('.settings-modal .inline-success')).toContainText('timezone has been updated');
  await page.getByLabel('Email copies (useful when JotRelay is closed)').check();
  await page.getByRole('button',{name:'Save notification preferences'}).click();
  await expect(page.locator('.settings-modal .inline-success')).toContainText('notification preferences have been saved');
  expect(state.db.profiles.find(profile=>profile.id===ME).timezone).toBe('Europe/London');
  expect(state.db.notification_preferences.find(preference=>preference.user_id===ME).email_notifications).toBe(true);
  expect(state.db.profiles.find(profile=>profile.id===ME).avatar_url).toContain('/daymark-avatars/');
  expect(state.calls.some(call=>call.path.endsWith('/auth/v1/user')&&call.body?.email==='raphael.new@example.com')).toBe(true);
  expect(state.calls.some(call=>call.path.endsWith('/auth/v1/user')&&call.body?.password==='new-password-123')).toBe(true);
  await expect(page.getByRole('button',{name:'Sign out of JotRelay'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('dialog',{name:'Profile & settings'})).toHaveCSS('width','390px');
  await page.screenshot({path:'test-results/mobile-profile-settings.png',animations:'disabled'});
  expect(state.errors).toEqual([]);
});

test('account export downloads personal and collaboration data without session credentials', async ({page})=>{
  const state=await setup(page);
  await page.locator('.sidebar-profile').click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download my data'}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^jotrelay-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(data.appVersion).toBe('1.8.1');
  expect(data.account.id).toBe(ME);
  expect(data.tasks.some(task=>task.id==='owned-task')).toBe(true);
  expect(data.collaboration.assignments.some(assignment=>assignment.id==='a2')).toBe(true);
  expect(JSON.stringify(data)).not.toContain('access_token');
  await expect(page.locator('.settings-modal .inline-success')).toContainText('export has been downloaded');
  expect(state.errors).toEqual([]);
});

test('mobile navigation uses purposeful icons and closes when the user taps outside', async ({page})=>{
  const state=await setup(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator('button.menu').click();
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  const todayIcon=page.locator('.nav-item').filter({hasText:'Today'}).locator('svg');
  const captureIcon=page.locator('.sidebar-tip svg');
  await expect(todayIcon).toBeVisible(); await expect(captureIcon).toBeVisible();
  expect(await todayIcon.getAttribute('class')).toContain('calendar-check');
  expect(await captureIcon.getAttribute('class')).toContain('notebook-pen');
  await page.screenshot({path:'test-results/mobile-sidebar-v16.png',animations:'disabled'});
  await page.getByRole('button',{name:'Close navigation',exact:true}).click({position:{x:370,y:400}});
  await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  expect(state.errors).toEqual([]);
});

test('mobile task editor fits the viewport, keeps actions visible and prevents iPhone field zoom', async ({page})=>{
  const state=await setup(page);
  await page.setViewportSize({width:390,height:844});
  await page.locator('button.menu').click();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  const dialog=page.getByRole('dialog').or(page.locator('.editor-modal')).first();
  const metrics=await page.locator('.editor-modal').evaluate(element=>{
    const box=element.getBoundingClientRect();
    const controls=[...element.querySelectorAll('input,select,textarea')];
    const footer=element.querySelector('.modal-foot')?.getBoundingClientRect();
    const form=element.querySelector('.form');
    return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,minFont:Math.min(...controls.map(control=>parseFloat(getComputedStyle(control).fontSize))),footerBottom:footer?.bottom,formScrolls:form.scrollHeight>form.clientHeight,viewportMeta:document.querySelector('meta[name="viewport"]')?.content,documentWidth:document.documentElement.scrollWidth};
  });
  expect(metrics.left).toBeGreaterThanOrEqual(0); expect(metrics.right).toBeLessThanOrEqual(390);
  expect(metrics.top).toBeGreaterThanOrEqual(0); expect(metrics.bottom).toBeLessThanOrEqual(845);
  expect(metrics.minFont).toBeGreaterThanOrEqual(16); expect(metrics.footerBottom).toBeLessThanOrEqual(845);
  expect(metrics.formScrolls).toBe(true); expect(metrics.viewportMeta).toContain('width=device-width'); expect(metrics.documentWidth).toBeLessThanOrEqual(390);
  await page.getByLabel('Task',{exact:true}).focus();
  await expect.poll(()=>page.evaluate(()=>visualViewport?.scale||1)).toBe(1);
  await page.screenshot({path:'test-results/mobile-task-editor.png',fullPage:true,animations:'disabled'});
  await expect(dialog).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('dark colored notes retain readable text contrast', async ({page})=>{
  const state=await setup(page);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await page.getByRole('button',{name:'New note',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Dark mode reference');
  await page.getByLabel('Note',{exact:true}).fill('Important details should stay easy to read.');
  await page.getByLabel(/^Color/).selectOption('sand');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.getByRole('switch',{name:'Use dark mode'}).click();
  const card=page.locator('.note-card').filter({hasText:'Dark mode reference'});
  const ratios=await card.evaluate(element=>{
    const rgb=value=>(value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
    const luminance=value=>{const values=rgb(value).map(channel=>{const n=channel/255;return n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)});return .2126*values[0]+.7152*values[1]+.0722*values[2]};
    const contrast=(foreground,background)=>{const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    const background=getComputedStyle(element).backgroundColor;
    return {heading:contrast(getComputedStyle(element.querySelector('h3')).color,background),body:contrast(getComputedStyle(element.querySelector('p')).color,background)};
  });
  expect(ratios.heading).toBeGreaterThanOrEqual(4.5); expect(ratios.body).toBeGreaterThanOrEqual(4.5);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/mobile-dark-note.png',fullPage:true,animations:'disabled'});
  expect(state.errors).toEqual([]);
});
