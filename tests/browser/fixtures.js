import { expect } from '@playwright/test';
export const ME = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const THIRD = '33333333-3333-4333-8333-333333333333';
const now = '2026-09-19T08:00:00Z';
const task = (id, owner, title) => ({ id, user_id: owner, title, completed: false, date: '2026-09-20', time: '10:00', priority: 'medium', category: 'Work', list_name: 'upcoming', repeat_rule: 'none', reminder: 'None', note: 'Please send the receipt after payment.', subtasks: [], source: { type: 'manual' }, created_at: now, updated_at: now, completed_at: null });

export async function setup(page, userId = ME) {
  const db = {
    profiles: [{ id: ME, display_name: 'Raphael', email: 'raphael@example.com', avatar_url: null, timezone:'Africa/Accra' }, { id: OTHER, display_name: 'Herbert', email: 'herbert@example.com', avatar_url: null, timezone:'Africa/Accra' }, { id: THIRD, display_name: 'Nana', email: 'nana@example.com', avatar_url: null, timezone:'Africa/Accra' }],
    connections: [{ id: 'c1', requester_id: ME, addressee_id: OTHER, status: 'accepted', created_at: now }, { id: 'c2', requester_id: THIRD, addressee_id: ME, status: 'pending', created_at: now }],
    tasks: [task('owned-task', ME, 'Review supplier payment'), task('shared-task', OTHER, 'Send payment receipt')],
    task_assignments: [{ id: 'a1', task_id: 'shared-task', owner_id: OTHER, assignee_id: ME, status: 'pending', assigned_at: now }],
    task_comments: [], task_activity: [{id:'activity-1',task_id:'shared-task',owner_id:OTHER,actor_id:OTHER,assignment_id:'a1',event_type:'assigned',created_at:now}], notifications: [], notification_deliveries: [], notification_preferences: [{ user_id:ME, contact_updates:true, assignment_updates:true, comment_updates:true, task_reminders:true, browser_notifications:true, email_notifications:false, updated_at:now }], daymark_email_invites: [], notes: [], attachments: [], deleted_items: [],
  };
  const calls = [], channels = [];
  const authMetadata = Object.fromEntries(db.profiles.map(person => [person.id, {}]));
  let current = userId, failAssign = false;
  const session = uid => { const person=db.profiles.find(p => p.id === uid); return { access_token: `${btoa('{}')}.${btoa(JSON.stringify({ sub: uid, role:'authenticated', exp: 4102444800 }))}.test`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user: { id: uid, email: person.email, user_metadata:{display_name:person.display_name,avatar_url:person.avatar_url,...authMetadata[uid]}, aud: 'authenticated', role: 'authenticated' } }; };
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
    const postData=request.postData(); let body=null;
    if(postData){try{body=JSON.parse(postData);}catch{body=postData;}}
    const ok = (data, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range', ...headers }, body: status === 204 ? '' : JSON.stringify(data) });
    const bad = message => ok({ message, code:'P0001' }, 400);
    calls.push({ path: url.pathname, method, body, query: url.search });
    if (url.pathname.startsWith('/storage/v1/object/daymark-avatars/')) return ok({ Key:url.pathname });
    if (url.pathname.startsWith('/storage/v1/object/public/daymark-avatars/')) return route.fulfill({ status:200, contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64') });
    if (url.pathname.includes('/auth/')) {
      if (url.pathname.endsWith('/logout')) return ok({}, 204);
      if (url.pathname.endsWith('/otp')) return ok({});
      if (url.pathname.endsWith('/token')) { current = db.profiles.find(p => p.email === body.email)?.id || current; return ok(session(current)); }
      if (url.pathname.endsWith('/user') && method === 'PUT') {
        const person=db.profiles.find(p=>p.id===current);
        if(body?.email) person.email=body.email;
        if(body?.data?.display_name) person.display_name=body.data.display_name;
        if(Object.prototype.hasOwnProperty.call(body?.data||{},'avatar_url')) person.avatar_url=body.data.avatar_url;
        if(body?.data) authMetadata[current]={...authMetadata[current],...body.data};
        return ok(session(current).user);
      }
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
      if (name === 'daymark_create_email_invite') {
        const existing=db.daymark_email_invites.find(i=>i.inviter_id===current&&i.invitee_email===body.invitee_email&&i.task_id===body.target_task&&i.status==='pending');
        const invite=existing||{id:`invite-${db.daymark_email_invites.length+1}`,inviter_id:current,invitee_email:body.invitee_email,task_id:body.target_task,status:'pending',created_at:now,expires_at:'2026-10-03T08:00:00Z'};
        invite.mock_token=`token-${invite.id}`; if(!existing)db.daymark_email_invites.push(invite);
        return ok([{invite_id:invite.id,invite_token:invite.mock_token,expires_at:invite.expires_at}]);
      }
      if (name === 'daymark_cancel_email_invite') {
        const invite=db.daymark_email_invites.find(i=>i.id===body.target_invite&&i.inviter_id===current&&i.status==='pending');
        if(!invite)return bad('Invitation is no longer available'); invite.status='cancelled'; return ok(null);
      }
      if (name === 'daymark_claim_email_invite') {
        const invite=db.daymark_email_invites.find(i=>i.mock_token===body.invite_token&&i.invitee_email===db.profiles.find(p=>p.id===current)?.email&&i.status==='pending');
        if(!invite)return bad('This invitation is no longer available');
        let connection=db.connections.find(c=>[c.requester_id,c.addressee_id].includes(invite.inviter_id)&&[c.requester_id,c.addressee_id].includes(current));
        if(!connection){connection={id:`claimed-c-${db.connections.length}`,requester_id:invite.inviter_id,addressee_id:current,status:'accepted'};db.connections.push(connection);}else connection.status='accepted';
        let assignment=null;
        if(invite.task_id){assignment={id:`claimed-a-${db.task_assignments.length}`,task_id:invite.task_id,owner_id:invite.inviter_id,assignee_id:current,status:'pending',assigned_at:now};db.task_assignments.push(assignment);}
        invite.status='claimed'; invite.claimed_by=current; return ok({invite_id:invite.id,connection_id:connection.id,task_id:invite.task_id,assignment_id:assignment?.id||null});
      }
      if (name === 'daymark_add_task_comment') {
        const existing=db.task_comments.find(comment=>comment.author_id===current&&comment.client_nonce===body.request_nonce);
        if(existing)return ok(existing.id);
        const assignment=db.task_assignments.find(a=>a.task_id===body.target_task&&(a.owner_id===current||(a.assignee_id===current&&['accepted','completed'].includes(a.status))));
        if(!assignment)return bad('You cannot comment on this task');
        const comment={id:`comment-${db.task_comments.length+1}`,task_id:body.target_task,author_id:current,body:body.comment_body,client_nonce:body.request_nonce,created_at:now};
        db.task_comments.push(comment);
        db.task_activity.push({id:`activity-${db.task_activity.length+1}`,task_id:body.target_task,owner_id:assignment.owner_id,actor_id:current,event_type:'commented',created_at:now});
        return ok(comment.id);
      }
      if (name === 'daymark_set_assignment_status') {
        const a=db.task_assignments.find(a=>a.id===body.target_assignment&&a.assignee_id===current);
        if(!a)return bad('Assignment not found');
        if(a.status!==body.target_status){
          const allowed=(a.status==='pending'&&['accepted','declined'].includes(body.target_status))||(a.status==='accepted'&&body.target_status==='completed');
          if(!allowed)return bad('This action is no longer available');
          a.status=body.target_status;
          db.task_activity.push({id:`activity-${db.task_activity.length+1}`,task_id:a.task_id,owner_id:a.owner_id,actor_id:current,assignment_id:a.id,event_type:body.target_status,created_at:now});
        }
        return ok({status:a.status});
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
    if (table === 'task_activity') rows=rows.filter(activity=>activity.owner_id===current||db.task_assignments.some(a=>a.task_id===activity.task_id&&a.assignee_id===current&&['pending','accepted','completed'].includes(a.status)));
    if (table === 'notification_preferences') rows=rows.filter(preference=>preference.user_id===current);
    if (table === 'daymark_email_invites') rows=rows.filter(invite=>invite.inviter_id===current);
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
      for (const row of Array.isArray(body)?body:[body]) { const existing=db[table].find(r=>(r.id&&r.id===row.id)||(table==='notification_preferences'&&r.user_id===row.user_id)); if(existing)Object.assign(existing,row); else db[table].push({id:row.id||`id-${db[table].length}`,created_at:now,...row}); }
      return ok(null,201);
    }
    return bad('Unexpected request');
  });
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/'); await expect(page.getByText('Collaboration connected', {exact:false})).toBeVisible();
  return { db, calls, emit, errors, authMetadata, failNextAssignment: () => { failAssign=true; }, addEmailInvite: invite => db.daymark_email_invites.push({id:`incoming-${db.daymark_email_invites.length}`,status:'pending',created_at:now,expires_at:'2026-10-03T08:00:00Z',...invite}) };
}
