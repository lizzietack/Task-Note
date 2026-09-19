import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, MessageCircle, Users, X } from 'lucide-react';
import { assignmentActions, canComment, personName } from '../lib/collaboration';
import { ProfileAvatar } from './AccountSettings';

export function Status({ status }) { return <span className={`collab-status ${status}`}>{status}</span>; }

function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  const run = async fn => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { await fn(); } catch (err) { setError(err.message || 'Could not save. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return { busy, error, run };
}

export function CollaborationHealth({ c }) {
  return <div className="collab-health" role="status">
    {!c.online ? 'Offline — collaboration will refresh when you reconnect.' : c.error ? `Collaboration: ${c.error}` : c.loading ? 'Loading collaboration…' : c.realtime === 'live' ? 'Collaboration connected' : 'Reconnecting live updates — checking every 30 seconds.'}
    {c.online && <button className="text-btn" onClick={c.refresh}>Refresh</button>}
  </div>;
}

export function ContactsView({ c }) {
  const [email, setEmail] = useState(''), [message, setMessage] = useState('');
  const { busy, error, run } = useAction();
  const groups = [
    ['Requests for you', c.connections.filter(x => x.status === 'pending' && x.addressee_id === c.uid)],
    ['Accepted contacts', c.connections.filter(x => x.status === 'accepted')],
    ['Sent requests', c.connections.filter(x => x.status === 'pending' && x.requester_id === c.uid)],
    ['Past requests', c.connections.filter(x => ['declined', 'cancelled'].includes(x.status))],
  ];
  return <>
    <div className="page-head"><div><span className="eyebrow">WORK TOGETHER</span><h1>Contacts</h1><p>Invite anyone by email, wherever they are.</p></div><Users size={28}/></div>
    <form className="collab-invite" onSubmit={e => { e.preventDefault(); run(async () => { setMessage(''); const result = await c.act('inviteAny', email); setEmail(''); setMessage(result.delivery === 'email' ? 'Invitation email sent. They can join Daymark securely from the link.' : 'Contact request sent. They can accept it in Daymark.'); }); }}>
      <label htmlFor="contact-email">Invite someone by email</label>
      <div className="collab-actions"><input id="contact-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="coworker@example.com"/><button className="primary" disabled={busy || !c.available || !email.trim()}>Send invitation</button></div>
      <small>Existing users receive an in-app request. New users receive a secure email link to join Daymark. No service-role key is used.</small>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}
    {c.emailInvites.some(invite => invite.status === 'pending') && <section className="task-section"><div className="section-row"><h2>Email invitations</h2><span>{c.emailInvites.filter(invite => invite.status === 'pending').length}</span></div><div className="collab-list">
      {c.emailInvites.filter(invite => invite.status === 'pending').map(invite => <div className="collab-card" key={invite.id}><div className="collab-person"><strong>{invite.invitee_email}</strong><small>{invite.task_id ? 'Task invitation emailed' : 'Invitation emailed'} · expires {new Date(invite.expires_at).toLocaleDateString()}</small></div><Status status="invited"/><button className="text-btn danger-text" disabled={busy || !c.available} onClick={() => run(() => c.act('cancelEmailInvite', invite.id))}>Cancel</button></div>)}
    </div></section>}
    {groups.map(([title, rows]) => <section className="task-section" key={title}><div className="section-row"><h2>{title}</h2><span>{rows.length}</span></div>
      <div className="collab-list">{rows.length ? rows.map(row => { const other = row.requester_id === c.uid ? row.addressee_id : row.requester_id; const profile = c.profiles[other];
        return <div className="collab-card" key={row.id}><ProfileAvatar profile={profile} small/><div className="collab-person"><strong>{personName(profile)}</strong><small>{profile?.email}</small></div><Status status={row.status}/>
          {row.status === 'pending' && row.addressee_id === c.uid && <div className="collab-actions"><button className="primary" disabled={busy || !c.available} onClick={() => run(() => c.act('respondContact', row.id, 'accepted'))}>Accept</button><button className="secondary" disabled={busy || !c.available} onClick={() => run(() => c.act('respondContact', row.id, 'declined'))}>Decline</button></div>}
        </div>;
      }) : <p className="empty-line">{c.loading ? 'Loading…' : 'No contacts in this section yet.'}</p>}</div>
    </section>)}
  </>;
}

export function AssignmentPicker({ c, taskId, value, onChange, inviteEmail, onInviteEmail, disabled }) {
  const used = new Set(c.assignments.filter(a => String(a.task_id) === String(taskId)).map(a => a.assignee_id));
  const choices = c.contacts.filter(id => !used.has(id));
  return <fieldset className="assignment-picker"><legend>Share this task (optional)</legend><label>Assign to a contact<select value={value} onChange={e => { onChange(e.target.value); if (e.target.value) onInviteEmail(''); }} disabled={disabled || !c.available || Boolean(inviteEmail)}>
    <option value="">{taskId ? 'No new assignment' : 'Just me'}</option>
    {choices.map(id => <option key={id} value={id}>{personName(c.profiles[id])}{c.profiles[id]?.email ? ` · ${c.profiles[id].email}` : ''}</option>)}
  </select></label><div className="assign-divider"><span>or</span></div><label>Invite by email<input type="email" value={inviteEmail} onChange={e => { onInviteEmail(e.target.value); if (e.target.value) onChange(''); }} disabled={disabled || !c.available || Boolean(value)} placeholder="person@example.com"/></label><small className="field-help">{!c.online ? 'Reconnect to share a task.' : 'Accepted contacts receive it in-app. Anyone else can receive a secure join link by email, then accept or decline the task.'}</small></fieldset>;
}

export function AssignmentResponses({ c, assignment }) {
  const { busy, error, run } = useAction();
  return <><div className="collab-actions">{assignmentActions(assignment, c.uid).map(action => <button key={action} className={action === 'declined' ? 'secondary' : 'primary'} disabled={busy || !c.available} onClick={() => run(() => c.act('respondAssignment', assignment, action))}>{action === 'accepted' ? 'Accept task' : action === 'declined' ? 'Decline task' : 'Complete assignment'}</button>)}</div>{error && <p role="alert" className="inline-error">{error}</p>}</>;
}

export function AssignedView({ c, onOpen }) {
  const [filter, setFilter] = useState('active');
  const mine = c.assignments.filter(a => a.assignee_id === c.uid);
  const rows = mine.filter(a => filter === 'all' || (filter === 'active' ? ['pending', 'accepted'].includes(a.status) : a.status === filter));
  return <><div className="page-head"><div><span className="eyebrow">FROM YOUR CONTACTS</span><h1>Assigned to me</h1><p>Accept what you can take on. Keep the owner updated.</p></div></div>
    <div className="segmented">{['active', 'pending', 'accepted', 'completed', 'declined', 'all'].map(f => <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>
    <div className="collab-list assigned-list">{rows.map(a => { const task = c.sharedTasks.find(t => t.id === a.task_id && t.user_id === a.owner_id); return <article className="collab-task-card" key={a.id}>
      <div className="collab-card-head"><div><small>From {personName(c.profiles[a.owner_id])}</small><h2><button className="collab-title" onClick={() => onOpen(a.id)}>{task?.title || 'Task details unavailable'}</button></h2></div><Status status={a.status}/></div>
      {task && <p className="collab-meta">{task.date ? `Due ${task.date}${task.time ? ` at ${task.time.slice(0, 5)}` : ''}` : 'No due date'} · {task.priority} priority{task.completed ? ' · Owner marked task complete' : ''}</p>}
      <AssignmentResponses c={c} assignment={a}/><button className="text-btn" onClick={() => onOpen(a.id)}><MessageCircle size={15}/> Details & comments</button>
    </article>; })}{!rows.length && <div className="empty-state"><Users/><h3>{c.loading ? 'Loading assignments…' : 'No assignments here'}</h3><p>Tasks your accepted contacts send you will appear here.</p></div>}</div>
  </>;
}

export function TaskCollaboration({ c, taskId }) {
  const rows = c.assignments.filter(a => String(a.task_id) === String(taskId));
  const invitations = c.emailInvites.filter(invite => String(invite.task_id) === String(taskId) && invite.status === 'pending');
  if (!rows.length && !invitations.length) return null;
  return <section className="task-collaboration"><h3>Assignments</h3>{invitations.map(invite => <div className="collab-card" key={invite.id}><div className="collab-person"><strong>{invite.invitee_email}</strong><small>Waiting for them to join Daymark</small></div><Status status="invited"/></div>)}{rows.map(a => <div className="collab-card" key={a.id}><ProfileAvatar profile={c.profiles[a.assignee_id]} small/><div className="collab-person"><strong>{personName(c.profiles[a.assignee_id])}</strong><small>You own this task</small></div><Status status={a.status}/></div>)}<p className="field-help">Assignment completion is separate from your task checkbox. Recurring tasks create a private next occurrence.</p>{rows.length > 0 && <Comments c={c} taskId={taskId} assignments={rows}/>}</section>;
}

function Comments({ c, taskId, assignments }) {
  const [rows, setRows] = useState([]), [body, setBody] = useState(''), [readError, setReadError] = useState(''), [loading, setLoading] = useState(true);
  const { busy, error, run } = useAction();
  useEffect(() => {
    let cancelled = false;
    c.api.comments(taskId).then(data => { if (!cancelled) { setRows(data); setReadError(''); setLoading(false); } }).catch(err => { if (!cancelled) { setRows([]); setReadError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [c.api, c.revision, taskId]);
  const allowed = canComment(assignments, c.uid);
  return <div className="collab-comments"><h3>Comments</h3><p className="field-help">Visible to people assigned to this task and its owner.</p>
    {readError && <p role="alert" className="inline-error">{readError}</p>}
    <div className="comment-list">{rows.map(row => <article key={row.id}><div><strong>{row.author_id === c.uid ? 'You' : personName(c.profiles[row.author_id])}</strong><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></div><p>{row.body}</p></article>)}{!rows.length && !readError && <p className="collab-meta">{loading ? 'Loading comments…' : 'No comments yet.'}</p>}</div>
    {allowed ? <form onSubmit={e => { e.preventDefault(); run(async () => { await c.act('addComment', taskId, body); setBody(''); }); }}><label>Add a comment<textarea value={body} maxLength={2000} onChange={e => setBody(e.target.value)} disabled={!c.available || busy}/></label><div className="collab-actions"><small>{body.length}/2,000</small><button className="primary" disabled={busy || !c.available || !body.trim()}>Post comment</button></div></form> : <p className="field-help">Comments can be added after an assignment is accepted.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}

export function AssignedDetail({ c, assignmentId, onClose }) {
  const a = c.assignments.find(row => row.id === assignmentId && row.assignee_id === c.uid);
  const task = a && c.sharedTasks.find(t => t.id === a.task_id && t.user_id === a.owner_id);
  const dialogRef = useRef(null);
  useEffect(() => { const previous = document.activeElement; dialogRef.current?.focus(); return () => previous?.focus(); }, []);
  return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="assignment-title" ref={dialogRef} tabIndex={-1} onKeyDown={e => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab') { const items = [...e.currentTarget.querySelectorAll('button:not(:disabled),textarea:not(:disabled)')]; const first = items[0], last = items.at(-1); if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }}>
    <div className="modal-head"><div><span className="eyebrow">ASSIGNED TO YOU</span><h2 id="assignment-title">{task?.title || 'Task details unavailable'}</h2></div><button className="icon" aria-label="Close assignment" onClick={onClose}><X/></button></div>
    <div className="form">{a ? <><div className="collab-actions"><span>Owner: {personName(c.profiles[a.owner_id])}</span><Status status={a.status}/></div>
      {task ? <><p className="collab-meta">{task.date ? `Due ${task.date} ${task.time?.slice(0, 5) || ''}` : 'No due date'} · {task.priority} priority · {task.category}</p>{task.note && <p className="shared-note">{task.note}</p>}{task.subtasks?.length > 0 && <ul className="shared-subtasks">{task.subtasks.map(s => <li key={s.id}>{s.done ? <Check size={14}/> : '○'} {s.text}</li>)}</ul>}<p className="field-help">The owner controls task details, subtasks and the task checkbox. You control your assignment status.</p></> : <p>Details may be unavailable because this assignment was declined, cancelled, or the task was removed.</p>}
      <AssignmentResponses c={c} assignment={a}/><Comments c={c} taskId={a.task_id} assignments={[a]}/></> : <p>This assignment is no longer available.</p>}</div>
  </div></div>;
}

export function NotificationBell({ c, onNavigate }) {
  const [open, setOpen] = useState(false), root = useRef(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <div className="notification-root" ref={root} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); root.current.querySelector('button')?.focus(); } }}>
    <button className="icon notification-bell" aria-label={`Notifications, ${c.unread} unread`} aria-expanded={open} onClick={() => setOpen(!open)}><Bell/>{c.unread > 0 && <b>{c.unread > 99 ? '99+' : c.unread}</b>}</button>
    {open && <section className="notification-panel" aria-label="Notifications"><div className="collab-card-head"><h2>Notifications</h2><button className="text-btn" disabled={busy || !c.available || !c.unread} onClick={() => run(() => c.act('markAllRead'))}>Mark all read</button></div>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {c.notifications.map(n => <article key={n.id} className={n.read_at ? '' : 'unread'}><button className="notification-link" onClick={() => { onNavigate(n); setOpen(false); if (!n.read_at && c.available) run(() => c.act('markRead', n.id)); }}><strong>{n.title}</strong><span>{n.message}</span><time>{new Date(n.created_at).toLocaleString()}</time></button>{!n.read_at && <button className="text-btn" disabled={busy || !c.available} onClick={() => run(() => c.act('markRead', n.id))}>Mark read</button>}</article>)}
      {!c.notifications.length && <p>{c.loading ? 'Loading…' : 'You’re all caught up.'}</p>}<small>Latest 100 notifications. The badge counts all unread notifications.</small>
    </section>}
  </div>;
}
