import { expect } from '@playwright/test';
export const ME = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const THIRD = '33333333-3333-4333-8333-333333333333';
const now = '2026-09-19T08:00:00Z';
const task = (id, owner, title) => ({ id, user_id: owner, title, completed: false, date: '2026-09-20', time: '10:00', priority: 'medium', category: 'Work', list_name: 'upcoming', repeat_rule: 'none', reminder: 'None', note: 'Please send the receipt after payment.', subtasks: [], source: { type: 'manual' }, created_at: now, updated_at: now, completed_at: null });

export async function setup(page, userId = ME) {
  const db = {
    profiles: [{ id: ME, display_name: 'Raphael', email: 'raphael@example.com' }, { id: OTHER, display_name: 'Herbert', email: 'herbert@example.com' }, { id: THIRD, display_name: 'Nana', email: 'nana@example.com' }],
    connections: [{ id: 'c1', requester_id: ME, addressee_id: OTHER, status: 'accepted', created_at: now }, { id: 'c2', requester_id: THIRD, addressee_id: ME, status: 'pending', created_at: now }],
    tasks: [task('owned-task', ME, 'Review supplier payment'), task('shared-task', OTHER, 'Send payment receipt')],
    task_assignments: [{ id: 'a1', task_id: 'shared-task', owner_id: OTHER, assignee_id: ME, status: 'pending', assigned_at: now }],
    task_comments: [], notifications: [], notes: [], attachments: [], deleted_items: [],
  };
  const calls = [], channels = [];
  let current = userId, failAssign = false;
  const session = uid => ({ access_token: `${btoa('{}')}.${btoa(JSON.stringify({ sub: uid, role:'authenticated', exp: 4102444800 }))}.test`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: { id: uid, email: db.profiles.find(p => p.id === uid).email, aud: 'authenticated', role: 'authenticated' } });
  await page.addInitScript(({ session, userId }) => {
    localStorage.setItem('sb-daymark-test-auth-token', JSON.stringify(session));
    localStorage.setItem(`daymark.${userId}.tasks.v1`, '[]'); localStorage.setItem(`daymark.${userId}.notes.v1`, '[]');
    localStorage.setItem('daymark.legacy-cache-owner.v1', userId);
  }, { session: session(userId), userId });
  const emit = table => {
    for (const channel of channels) {
      const ids = channel.bindings.filter(b => b.table === table).map(b => b.id);
      if (ids.length) channel.ws.send(JSON.stringify([channel.joinRef, null, channel.topic, 'postgres_changes', { ids, data: { schema: 'public', table, type: 'UPDATE', commit_timestamp: now, columns: [], record: {}, old_record: {} } }]));
    }
  };
  await page.routeWebSocket('wss://daymark-test.supabase.co/**', ws => {
    ws.onMessage(raw => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw));
      const message = { joinRef, ref, topic, event, payload };
      if (message.event === 'phx_join') {
        const bindings = (message.payload.config.postgres_changes || []).map((b, i) => ({ ...b, id: i + 1 }));
        channels.push({ ws, joinRef, topic: message.topic, bindings });
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status:'ok', response: { postgres_changes: bindings } }]));
      } else if (message.event === 'heartbeat' || message.event === 'phx_leave') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', {status:'ok',response:{}}]));
      }
    });
  });
  await page.route('https://daymark-test.supabase.co/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    const ok = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', ...headers }, body: status === 204 ? '' : JSON.stringify(data) });
    const bad = message => ok({ message, code:'P0001' }, 400);
    calls.push({ path: url.pathname, method, body, query: url.search });
    if (url.pathname.includes('/auth/')) {
      if (url.pathname.endsWith('/logout')) return ok({}, 204);
      if (url.pathname.endsWith('/token')) { current = db.profiles.find(p => p.email === body.email)?.id || current; return ok(session(current)); }
      return ok(session(current).user);
    }
    if (url.pathname.includes('/rpc/')) {
      const name = url.pathname.split('/').at(-1);
      if (name === 'daymark_invite_contact') {
        const person = db.profiles.find(p => p.email === body.invitee_email);
        if (!person) return bad('No Daymark user found with that email');
        if (person.id === current) return bad('You cannot add yourself');
        if (db.connections.some(c => [c.requester_id,c.addressee_id].includes(current) && [c.requester_id,c.addressee_id].includes(person.id))) return bad('A Daymark contact relationship already exists');
        db.connections.push({ id:'new-c', requester_id:current, addressee_id:person.id, status:'pending' }); return ok('new-c');
      }
      if (name === 'daymark_respond_contact') { db.connections.find(c=>c.id===body.target_connection).status=body.response; return ok(null); }
      if (name === 'daymark_assign_task') {
        if (failAssign) { failAssign=false; return bad('Temporary connection problem'); }
        if (!db.tasks.some(t=>t.id===body.target_task && t.user_id===current)) return bad('Task not found or you do not own it');
        if (db.task_assignments.some(a=>a.task_id===body.target_task && a.assignee_id===body.target_user)) return bad('Assignment already exists');
        db.task_assignments.push({id:'new-a',task_id:body.target_task,owner_id:current,assignee_id:body.target_user,status:'pending',assigned_at:now}); return ok('new-a');
      }
      if (name === 'daymark_respond_assignment' || name === 'daymark_complete_assignment') {
        const a=db.task_assignments.find(a=>a.id===body.target_assignment && a.assignee_id===current);
        if (!a) return bad('Assignment not found'); a.status=body.response||'completed'; return ok(null);
      }
      return bad('Unexpected RPC');
    }
    const table = url.pathname.split('/').at(-1);
    if (!(table in db)) return ok({ message:'Unknown table' }, 404);
    let rows = db[table];
    if (table === 'tasks') rows = rows.filter(t => t.user_id === current || db.task_assignments.some(a => a.task_id === t.id && a.assignee_id === current && ['pending','accepted','completed'].includes(a.status)));
    if (table === 'notes') rows = rows.filter(n=>n.user_id===current);
    if (table === 'task_assignments') rows=rows.filter(a=>a.owner_id===current||a.assignee_id===current);
    for (const [field,value] of url.searchParams) {
      if (value.startsWith('eq.')) rows=rows.filter(r=>String(r[field])===value.slice(3));
      if (value.startsWith('neq.')) rows=rows.filter(r=>String(r[field])!==value.slice(4));
      if (value==='is.null') rows=rows.filter(r=>r[field]==null);
      if (value.startsWith('in.(')) { const ids=value.slice(4,-1).split(',').map(x=>x.replaceAll('"','')); rows=rows.filter(r=>ids.includes(String(r[field]))); }
    }
    if (method === 'HEAD') return ok(null, 200, { 'content-range':`0-0/${rows.length}` });
    if (method === 'GET') { const start=Number(url.searchParams.get('offset')||0), limit=Number(url.searchParams.get('limit')||10000); return ok(rows.slice(start,start+limit)); }
    if (method === 'PATCH') { rows.forEach(row=>Object.assign(row,body)); return ok(null,204); }
    if (method === 'DELETE') { db[table]=db[table].filter(r=>!rows.includes(r)); return ok(null,204); }
    if (method === 'POST') {
      for (const row of Array.isArray(body)?body:[body]) { const existing=db[table].find(r=>r.id && r.id===row.id); if(existing)Object.assign(existing,row); else db[table].push({id:row.id||`id-${db[table].length}`,created_at:now,...row}); }
      return ok(null,201);
    }
    return bad('Unexpected request');
  });
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('Collaboration connected', {exact:false})).toBeVisible();
  return { db, calls, emit, errors, failNextAssignment: () => { failAssign=true; } };
}
