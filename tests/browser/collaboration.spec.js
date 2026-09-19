import { test, expect } from '@playwright/test';
import { setup, ME, OTHER, THIRD } from './fixtures';

test('contacts accept and decline, exact email invitation errors, eligible recipients', async ({ page }) => {
  const { db, errors } = await setup(page);
  await page.getByRole('button', { name:'Contacts', exact:false }).click();
  await page.getByRole('button', { name:'Accept', exact:true }).click();
  expect(db.connections.find(c=>c.id==='c2').status).toBe('accepted');
  await page.getByLabel('Invite a Daymark user by email').fill('missing@example.com');
  await page.getByRole('button',{name:'Send request'}).click();
  await expect(page.getByRole('alert')).toContainText('No Daymark user found');
  db.profiles.push({ id:'44444444-4444-4444-8444-444444444444', display_name:'New colleague',email:'new@example.com' });
  await page.getByLabel('Invite a Daymark user by email').fill('new@example.com');
  await page.getByRole('button',{name:'Send request'}).click();
  await expect(page.getByText('Contact request sent.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await expect(page.getByLabel('Assign to (optional)').locator('option')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('owner creates and assigns once; failed assignment preserves the saved task for retry', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('button',{name:'New task',exact:true}).click();
  await page.getByLabel('Task',{exact:true}).fill('Prepare monthly report');
  await page.getByLabel('Assign to (optional)').selectOption(OTHER);
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
  await page.getByRole('dialog').getByRole('button',{name:'Complete assignment'}).click();
  await expect(page.getByRole('dialog').getByText('completed',{exact:true})).toBeVisible();
  expect(state.db.tasks.find(t=>t.id==='shared-task').completed).toBe(false);
  expect(state.calls.filter(c=>c.method==='POST' && c.path.endsWith('/tasks')).flatMap(c=>c.body).some(t=>t.id==='shared-task')).toBe(false);
  const cached = await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.tasks.v1`)),ME);
  expect(cached.some(t=>t.id==='shared-task')).toBe(false);
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
  await page.getByPlaceholder(/^Try: Call Nana/).fill('Remember the meeting room code');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.getByText('the meeting room code',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('.search-large input').fill('meeting');
  await expect(page.getByText('the meeting room code',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await page.getByLabel('Email').fill('herbert@example.com'); await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByText('herbert@example.com',{exact:true})).toBeVisible();
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
  await expect(page.getByRole('button',{name:'Accept task'})).toBeDisabled();
  await expect(page.getByText('Offline — collaboration will refresh',{exact:false})).toBeVisible();
  await page.locator('button.fab').click();
  await page.getByPlaceholder(/^Try: Call Nana/).fill('Remember an offline note');
  await page.getByRole('button',{name:'Save note',exact:true}).click();
  expect(await page.evaluate(uid=>JSON.parse(localStorage.getItem(`daymark.${uid}.notes.v1`)).some(n=>n.title==='an offline note'),ME)).toBe(true);
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
  await page.getByRole('button',{name:'Toggle theme'}).click();
  await expect(page.locator('.app')).toHaveClass('app dark');
  await page.getByRole('button',{name:'Calendar',exact:true}).click();
  await expect(page.locator('.calendar-shell')).toBeVisible();
  await page.getByRole('button',{name:'Contacts',exact:false}).click();
  await page.screenshot({path:'test-results/desktop-contacts.png',fullPage:true});
  expect(state.errors).toEqual([]);
});
