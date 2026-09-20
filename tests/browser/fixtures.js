import { expect } from '@playwright/test';
export const ME = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const THIRD = '33333333-3333-4333-8333-333333333333';
const now = '2026-09-19T08:00:00Z';
const task = (id, owner, title) => ({ id, user_id: owner, title, completed: false, date: '2026-09-20', time: '10:00', priority: 'medium', category: 'Work', list_name: 'upcoming', repeat_rule: 'none', reminder: 'None', note: 'Please send the receipt after payment.', subtasks: [], source: { type: 'manual' }, shared_list_id: null, created_at: now, updated_at: now, completed_at: null });

export async function setup(page, userId = ME) {
  const db = {
    profiles: [{ id: ME, display_name: 'Raphael', email: 'raphael@example.com', avatar_url: null, timezone:'Africa/Accra' }, { id: OTHER, display_name: 'Herbert', email: 'herbert@example.com', avatar_url: null, timezone:'Africa/Accra' }, { id: THIRD, display_name: 'Nana', email: 'nana@example.com', avatar_url: null, timezone:'Africa/Accra' }],
    connections: [{ id: 'c1', requester_id: ME, addressee_id: OTHER, status: 'accepted', created_at: now }, { id: 'c2', requester_id: THIRD, addressee_id: ME, status: 'pending', created_at: now }],
    tasks: [task('owned-task', ME, 'Review supplier payment'), task('shared-task', OTHER, 'Send payment receipt')],
    task_assignments: [{ id: 'a1', task_id: 'shared-task', owner_id: OTHER, assignee_id: ME, status: 'pending', assigned_at: now }, { id: 'a2', task_id: 'owned-task', owner_id: ME, assignee_id: OTHER, status: 'accepted', assigned_at: now, responded_at: now }],
    task_comments: [], task_activity: [{id:'activity-1',task_id:'shared-task',owner_id:OTHER,actor_id:OTHER,assignment_id:'a1',event_type:'assigned',created_at:now},{id:'activity-2',task_id:'owned-task',owner_id:ME,actor_id:ME,assignment_id:'a2',event_type:'assigned',created_at:now},{id:'activity-3',task_id:'owned-task',owner_id:ME,actor_id:OTHER,assignment_id:'a2',event_type:'accepted',created_at:now}], notifications: [], notification_deliveries: [], notification_preferences: [{ user_id:ME, contact_updates:true, assignment_updates:true, comment_updates:true, task_reminders:true, browser_notifications:true, push_notifications:false, email_notifications:false, updated_at:now }], daymark_email_invites: [], shared_task_lists: [], shared_list_members: [], task_attachments: [], comment_mentions: [], calendar_feed_tokens: [], notes: [], attachments: [], deleted_items: [],
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
    if (url.pathname.startsWith('/storage/v1/object/sign/daymark-attachments')) return ok((body?.paths||[]).map(path=>({signedURL:`https://daymark-test.supabase.co/storage/v1/object/sign/daymark-attachments/${path}?token=test`,signedUrl:`https://daymark-test.supabase.co/storage/v1/object/sign/daymark-attachments/${path}?token=test`,path})));
    if (url.pathname.startsWith('/storage/v1/object/daymark-attachments')) return ok(method==='DELETE'?{}:{Key:url.pathname});
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
      if (name === 'daymark_invite_or_reconnect_contact') {
        const person = db.profiles.find(p => p.email === body.invitee_email);
        if (!person) return bad('No Daymark user found with that email');
        if (person.id === current) return bad('You cannot add yourself');
        const existing=db.connections.find(c => [c.requester_id,c.addressee_id].includes(current) && [c.requester_id,c.addressee_id].includes(person.id));
        if(existing&&['pending','accepted'].includes(existing.status))return bad(existing.status==='accepted'?'You are already Daymark contacts':'A Daymark contact request is already pending');
        if(existing){Object.assign(existing,{requester_id:current,addressee_id:person.id,status:'pending',responded_at:null,updated_at:now});return ok(existing.id);}
        db.connections.push({ id:'new-c', requester_id:current, addressee_id:person.id, status:'pending',updated_at:now }); return ok('new-c');
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
      if (name === 'daymark_add_task_comment' || name === 'daymark_add_task_comment_v2') {
        const existing=db.task_comments.find(comment=>comment.author_id===current&&comment.client_nonce===body.request_nonce);
        if(existing)return ok(existing.id);
        const assignment=db.task_assignments.find(a=>a.task_id===body.target_task&&(a.owner_id===current||(a.assignee_id===current&&['accepted','completed'].includes(a.status))));
        if(!assignment)return bad('You cannot comment on this task');
        const comment={id:`comment-${db.task_comments.length+1}`,task_id:body.target_task,author_id:current,body:body.comment_body,client_nonce:body.request_nonce,created_at:now};
        db.task_comments.push(comment);
        db.task_activity.push({id:`activity-${db.task_activity.length+1}`,task_id:body.target_task,owner_id:assignment.owner_id,actor_id:current,event_type:'commented',created_at:now});
        for(const userId of body.mentioned_users||[]){db.comment_mentions.push({comment_id:comment.id,user_id:userId,mentioned_by:current,created_at:now});db.notifications.push({id:`notification-${db.notifications.length+1}`,user_id:userId,actor_id:current,type:'comment_mention',title:'You were mentioned',message:'A collaborator mentioned you in a task comment.',task_id:body.target_task,created_at:now,read_at:null});}
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
      if (name === 'daymark_cancel_assignment') {
        const a=db.task_assignments.find(a=>a.id===body.target_assignment&&a.owner_id===current);
        if(!a)return bad('Assignment not found');
        if(a.status==='cancelled')return ok({status:'cancelled',replayed:true});
        if(!['pending','accepted'].includes(a.status))return bad('This assignment can no longer be cancelled');
        a.status='cancelled'; a.updated_at=now;
        db.task_activity.push({id:`activity-${db.task_activity.length+1}`,task_id:a.task_id,owner_id:a.owner_id,actor_id:current,assignment_id:a.id,event_type:'cancelled',created_at:now});
        db.notifications.push({id:`notification-${db.notifications.length+1}`,user_id:a.assignee_id,actor_id:current,type:'assignment_cancelled',title:'Assignment cancelled',message:'A shared task was cancelled.',task_id:a.task_id,assignment_id:a.id,created_at:now,read_at:null});
        return ok({status:'cancelled',replayed:false});
      }
      if (name === 'daymark_close_connection') {
        const connection=db.connections.find(c=>c.id===body.target_connection&&[c.requester_id,c.addressee_id].includes(current));
        if(!connection)return bad('Contact relationship not found');
        if(connection.status==='cancelled')return ok({status:'cancelled',assignments_cancelled:0,replayed:true});
        if(connection.status==='pending'&&connection.requester_id!==current)return bad('Only the sender can cancel this request');
        if(!['pending','accepted'].includes(connection.status))return bad('This contact relationship is already closed');
        const previous=connection.status,other=connection.requester_id===current?connection.addressee_id:connection.requester_id;
        connection.status='cancelled'; connection.updated_at=now;
        let count=0;
        if(previous==='accepted')for(const a of db.task_assignments){if(['pending','accepted'].includes(a.status)&&((a.owner_id===current&&a.assignee_id===other)||(a.owner_id===other&&a.assignee_id===current))){a.status='cancelled';a.updated_at=now;count+=1;db.task_activity.push({id:`activity-${db.task_activity.length+1}`,task_id:a.task_id,owner_id:a.owner_id,actor_id:current,assignment_id:a.id,event_type:'cancelled',created_at:now});}}
        return ok({status:'cancelled',assignments_cancelled:count,replayed:false});
      }
      if (name === 'daymark_respond_contact') { db.connections.find(c=>c.id===body.target_connection).status=body.response; return ok(null); }
      if (name === 'daymark_assign_or_reactivate_task') {
        if (failAssign) { failAssign=false; return bad('Temporary connection problem'); }
        if (!db.tasks.some(t=>t.id===body.target_task && t.user_id===current)) return bad('Task not found or you do not own it');
        const existing=db.task_assignments.find(a=>a.task_id===body.target_task&&a.assignee_id===body.target_user);
        if(existing){if(['pending','accepted'].includes(existing.status))return bad('This assignment is already active');Object.assign(existing,{status:'pending',assigned_at:now,responded_at:null,completed_at:null,updated_at:now});return ok(existing.id);}
        db.task_assignments.push({id:'new-a',task_id:body.target_task,owner_id:current,assignee_id:body.target_user,status:'pending',assigned_at:now}); return ok('new-a');
      }
      if (name === 'daymark_set_task_collaborators') {
        if (failAssign) { failAssign=false; return bad('Temporary connection problem'); }
        const ownedTask=db.tasks.find(t=>t.id===body.target_task&&t.user_id===current); if(!ownedTask)return bad('Task not found');
        ownedTask.shared_list_id=body.target_list||null;
        const members=body.target_list?db.shared_list_members.filter(row=>row.list_id===body.target_list).map(row=>row.user_id):[];
        const recipients=[...new Set([...(body.target_users||[]),...members])]; let count=0;
        for(const userId of recipients){const existing=db.task_assignments.find(a=>a.task_id===body.target_task&&a.owner_id===current&&a.assignee_id===userId);if(existing){if(!['pending','accepted'].includes(existing.status)){Object.assign(existing,{status:'pending',assigned_at:now,responded_at:null,completed_at:null});count+=1;}}else{db.task_assignments.push({id:`new-a${db.task_assignments.length}`,task_id:body.target_task,owner_id:current,assignee_id:userId,status:'pending',assigned_at:now});count+=1;}}
        return ok(count);
      }
      if (name === 'daymark_save_shared_list') {
        let list=body.target_list&&db.shared_task_lists.find(row=>row.id===body.target_list&&row.owner_id===current);
        if(!list){list={id:`list-${db.shared_task_lists.length+1}`,owner_id:current,created_at:now};db.shared_task_lists.push(list);} Object.assign(list,{name:body.list_name,color:body.list_color,updated_at:now});
        db.shared_list_members=db.shared_list_members.filter(row=>row.list_id!==list.id||(body.member_ids||[]).includes(row.user_id));
        for(const userId of body.member_ids||[])if(!db.shared_list_members.some(row=>row.list_id===list.id&&row.user_id===userId))db.shared_list_members.push({list_id:list.id,user_id:userId,role:'member',created_at:now});
        return ok(list.id);
      }
      if (name === 'daymark_delete_shared_list') { const list=db.shared_task_lists.find(row=>row.id===body.target_list&&row.owner_id===current); if(!list)return bad('Shared list not found'); db.shared_task_lists=db.shared_task_lists.filter(row=>row!==list);db.shared_list_members=db.shared_list_members.filter(row=>row.list_id!==list.id);db.tasks.filter(row=>row.user_id===current&&row.shared_list_id===list.id).forEach(row=>row.shared_list_id=null);return ok(null); }
      if (name === 'daymark_get_calendar_token') { let row=db.calendar_feed_tokens.find(item=>item.user_id===current);if(!row){row={user_id:current,token:'a'.repeat(64),created_at:now,updated_at:now};db.calendar_feed_tokens.push(row);}if(body.rotate)row.token='b'.repeat(64);return ok(row.token); }
      if (name === 'daymark_delete_account') { if(body.confirm_text!=='DELETE')return bad('Type DELETE to confirm account deletion');return ok(true); }
      if (name === 'daymark_respond_assignment' || name === 'daymark_complete_assignment') {
        const a=db.task_assignments.find(a=>a.id===body.target_assignment && a.assignee_id===current);
        if (!a) return bad('Assignment not found'); a.status=body.response||'completed'; return ok(null);
      }
      return bad('Unexpected RPC');
    }
    const table = url.pathname.split('/').at(-1);
    if (!(table in db)) return ok({ message:'Unknown table' }, 404);
    let rows = db[table];
    if (table === 'profiles') rows=rows.filter(profile=>profile.id===current||db.connections.some(connection=>['pending','accepted'].includes(connection.status)&&[connection.requester_id,connection.addressee_id].includes(current)&&[connection.requester_id,connection.addressee_id].includes(profile.id)));
    if (table === 'tasks') rows = rows.filter(t => t.user_id === current || db.task_assignments.some(a => a.task_id === t.id && a.assignee_id === current && ['pending','accepted','completed'].includes(a.status)));
    if (table === 'notes') rows = rows.filter(n=>n.user_id===current);
    if (table === 'task_assignments') rows=rows.filter(a=>a.owner_id===current||a.assignee_id===current);
    if (table === 'task_activity') rows=rows.filter(activity=>activity.owner_id===current||db.task_assignments.some(a=>a.task_id===activity.task_id&&a.assignee_id===current&&['pending','accepted','completed'].includes(a.status)));
    if (table === 'task_comments') rows=rows.filter(comment=>db.task_assignments.some(a=>a.task_id===comment.task_id&&(a.owner_id===current||(a.assignee_id===current&&['pending','accepted','completed'].includes(a.status)))));
    if (table === 'notification_preferences') rows=rows.filter(preference=>preference.user_id===current);
    if (table === 'daymark_email_invites') rows=rows.filter(invite=>invite.inviter_id===current);
    if (table === 'shared_task_lists') rows=rows.filter(list=>list.owner_id===current||db.shared_list_members.some(member=>member.list_id===list.id&&member.user_id===current));
    if (table === 'shared_list_members') rows=rows.filter(member=>db.shared_task_lists.some(list=>list.id===member.list_id&&(list.owner_id===current||db.shared_list_members.some(row=>row.list_id===list.id&&row.user_id===current))));
    if (table === 'task_attachments') rows=rows.filter(attachment=>attachment.owner_id===current||db.task_assignments.some(a=>a.task_id===attachment.task_id&&a.owner_id===attachment.owner_id&&a.assignee_id===current&&['pending','accepted','completed'].includes(a.status)));
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
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Today', exact: true, level: 1 })).toBeVisible();
  return { db, calls, emit, errors, authMetadata, failNextAssignment: () => { failAssign=true; }, addEmailInvite: invite => db.daymark_email_invites.push({id:`incoming-${db.daymark_email_invites.length}`,status:'pending',created_at:now,expires_at:'2026-10-03T08:00:00Z',...invite}) };
}
