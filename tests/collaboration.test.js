import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentActions, canComment, acceptedContacts, collaborationApi, allRows } from '../src/lib/collaboration.js';
import { migrateAccountCache } from '../src/lib/accountCache.js';

test('only the pending assignee can respond; only accepted assignments can complete', () => {
  const row = { id: 'a', owner_id: 'owner', assignee_id: 'assignee', status: 'pending' };
  assert.deepEqual(assignmentActions(row, 'owner'), []);
  assert.deepEqual(assignmentActions(row, 'stranger'), []);
  assert.deepEqual(assignmentActions(row, 'assignee'), ['accepted', 'declined']);
  assert.deepEqual(assignmentActions({ ...row, status: 'accepted' }, 'assignee'), ['completed']);
  for (const status of ['completed', 'declined', 'cancelled']) assert.deepEqual(assignmentActions({ ...row, status }, 'assignee'), []);
});
test('comments require a participating accepted or completed assignment', () => {
  const row = { owner_id: 'owner', assignee_id: 'assignee', status: 'accepted' };
  assert.ok(canComment([row], 'owner')); assert.ok(canComment([row], 'assignee'));
  assert.equal(canComment([row], 'stranger'), false);
  assert.equal(canComment([{ ...row, status: 'pending' }], 'assignee'), false);
  assert.equal(canComment([{ ...row, status: 'declined' }], 'assignee'), false);
  assert.ok(canComment([{ ...row, status: 'completed' }], 'assignee'));
});
test('accepted contacts work in both directions and exclude pending/other users', () => {
  assert.deepEqual(acceptedContacts([
    { requester_id: 'me', addressee_id: 'a', status: 'accepted' },
    { requester_id: 'b', addressee_id: 'me', status: 'accepted' },
    { requester_id: 'me', addressee_id: 'c', status: 'pending' },
    { requester_id: 'x', addressee_id: 'y', status: 'accepted' },
  ], 'me'), ['a', 'b']);
});
test('RPC calls match the installed text-ID migration and reject unauthorized transitions', async () => {
  const calls = [], api = collaborationApi({ rpc: async (name, args) => { calls.push({ name, args }); return { data: 'ok', error: null }; } }, 'me');
  await api.invite(' colleague@example.com '); await api.respondContact('c', 'accepted'); await api.assign(123, 'other');
  await api.respondAssignment({ id: 'a', assignee_id: 'me', status: 'pending' }, 'declined');
  await api.respondAssignment({ id: 'a', assignee_id: 'me', status: 'accepted' }, 'completed');
  assert.deepEqual(calls, [
    { name: 'daymark_invite_contact', args: { invitee_email: 'colleague@example.com' } },
    { name: 'daymark_respond_contact', args: { target_connection: 'c', response: 'accepted' } },
    { name: 'daymark_assign_task', args: { target_task: '123', target_user: 'other' } },
    { name: 'daymark_respond_assignment', args: { target_assignment: 'a', response: 'declined' } },
    { name: 'daymark_complete_assignment', args: { target_assignment: 'a' } },
  ]);
  assert.throws(() => api.respondAssignment({ id: 'a', assignee_id: 'other', status: 'accepted' }, 'completed'));
  assert.throws(() => api.respondContact('c', 'cancelled'));
});
test('RPC permission errors reach the UI instead of reporting success', async () => {
  const api = collaborationApi({ rpc: async () => ({ error: new Error('Not an accepted contact') }) }, 'me');
  await assert.rejects(api.assign('t', 'stranger'), /Not an accepted contact/);
});
test('comments validate length and insert only caller-authored task comments', async () => {
  let inserted;
  const api = collaborationApi({ from: name => { assert.equal(name, 'task_comments'); return { insert: async row => { inserted = row; return { data: null }; } }; } }, 'me');
  assert.throws(() => api.addComment('t', '   ')); assert.throws(() => api.addComment('t', 'x'.repeat(2001)));
  await api.addComment(42, '  Progress update  ');
  assert.deepEqual(inserted, { task_id: '42', author_id: 'me', body: 'Progress update' });
});
test('read notifications are scoped to the authenticated recipient and unread rows', async () => {
  const calls = [];
  const builder = { update(value) { calls.push(['update', value]); return this; }, eq(k,v) { calls.push(['eq', k,v]); return this; }, is(k,v) { calls.push(['is', k,v]); return Promise.resolve({ data: null }); } };
  const api = collaborationApi({ from: table => { assert.equal(table, 'notifications'); return builder; } }, 'me');
  await api.markRead('notification');
  assert.deepEqual(calls.slice(1), [['eq','user_id','me'],['eq','id','notification'],['is','read_at',null]]);
});
test('pagination does not drop contacts beyond the first server page', async () => {
  const source = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const result = await allRows(() => ({ range: async (start, end) => ({ data: source.slice(start, end + 1) }) }));
  assert.equal(result.length, 1201); assert.equal(result[1200].id, 1200);
});
test('legacy caches are imported once; switching accounts never copies tasks or deletes', () => {
  const map = new Map([['daily-organizer.tasks.v2', JSON.stringify([{id: 'legacy', title:'Private'}])], ['daymark.sync.delete-queue.v1', JSON.stringify([{ id:'old', type:'task' }])]]);
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  migrateAccountCache(storage, 'a'); migrateAccountCache(storage, 'b');
  assert.equal(JSON.parse(map.get('daymark.a.tasks.v1'))[0].title, 'Private');
  assert.deepEqual(JSON.parse(map.get('daymark.b.tasks.v1')), []);
  assert.equal(map.has('daymark.sync.delete-queue.v1.b'), false);
  map.set('daymark.a.tasks.v1', '[]'); migrateAccountCache(storage, 'a');
  assert.deepEqual(JSON.parse(map.get('daymark.a.tasks.v1')), []);
});
