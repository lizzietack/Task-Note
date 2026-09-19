import React, { useEffect, useRef, useState } from 'react';
import { Activity, Bell, Check, MessageCircle, RefreshCw, Send, UserMinus, Users, WifiOff, X } from 'lucide-react';
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
    {!c.online ? `Offline — ${c.outbox.length ? `${c.outbox.length} collaboration ${c.outbox.length === 1 ? 'change is' : 'changes are'} safely queued.` : 'collaboration will refresh when you reconnect.'}` : c.error ? `Collaboration: ${c.error}` : c.outbox.length ? `${c.outbox.length} collaboration ${c.outbox.length === 1 ? 'change is' : 'changes are'} waiting to sync.` : c.loading ? 'Loading collaboration…' : c.realtime === 'live' ? 'Collaboration connected' : 'Reconnecting live updates — checking every 30 seconds.'}
    {c.online && <button className="text-btn" onClick={c.outbox.length ? c.flushOutbox : c.refresh}>{c.outbox.length ? 'Retry now' : 'Refresh'}</button>}
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
  const pendingInvites = c.emailInvites.filter(invite => invite.status === 'pending' && new Date(invite.expires_at).getTime() > Date.now());
  const invitationHistory = c.emailInvites.filter(invite => !pendingInvites.includes(invite)).slice(0, 10);
  const closeConnection = row => {
    const accepted = row.status === 'accepted';
    const prompt = accepted
      ? 'Remove this contact? Active assignments between you will be cancelled and shared-task access will be revoked.'
      : 'Cancel this contact request?';
    if (!window.confirm(prompt)) return;
    run(async () => {
      const result = await c.act('closeConnection', row.id);
      setMessage(accepted
        ? `Contact removed. ${result?.assignments_cancelled || 0} active ${result?.assignments_cancelled === 1 ? 'assignment was' : 'assignments were'} cancelled.`
        : 'Contact request cancelled.');
    });
  };
  return <>
    <div className="page-head"><div><span className="eyebrow">WORK TOGETHER</span><h1>Contacts</h1><p>Invite anyone by email, wherever they are.</p></div><Users size={28}/></div>
    <form className="collab-invite" onSubmit={e => { e.preventDefault(); run(async () => { setMessage(''); const result = await c.act('inviteAny', email); setEmail(''); setMessage(result.delivery === 'email' ? 'Invitation email sent. They can join Daymark securely from the link.' : 'Contact request sent. They can accept it in Daymark.'); }); }}>
      <label htmlFor="contact-email">Invite someone by email</label>
      <div className="collab-actions"><input id="contact-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="coworker@example.com"/><button className="primary" disabled={busy || !c.available || !email.trim()}>Send invitation</button></div>
      <small>Existing users receive an in-app request. New users receive a secure email link to join Daymark.</small>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="inline-success" role="status">{message}</p>}
    {pendingInvites.length > 0 && <section className="task-section"><div className="section-row"><h2>Email invitations</h2><span>{pendingInvites.length}</span></div><div className="collab-list">
      {pendingInvites.map(invite => <div className="collab-card" key={invite.id}><div className="collab-person"><strong>{invite.invitee_email}</strong><small>{invite.task_id ? 'Task invitation emailed' : 'Invitation emailed'} · expires {new Date(invite.expires_at).toLocaleString()}</small></div><Status status="invited"/><div className="collab-actions"><button className="text-btn" disabled={busy || !c.available} onClick={() => run(async () => { await c.act('resendEmailInvite', invite); setMessage(`A fresh invitation was sent to ${invite.invitee_email}.`); })}><RefreshCw size={14}/> Resend</button><button className="text-btn danger-text" disabled={busy || !c.available} onClick={() => run(() => c.act('cancelEmailInvite', invite.id))}>Cancel</button></div></div>)}
    </div></section>}
    {invitationHistory.length > 0 && <section className="task-section"><div className="section-row"><h2>Invitation history</h2><span>{invitationHistory.length}</span></div><div className="collab-list">{invitationHistory.map(invite => { const status = invite.status === 'pending' ? 'expired' : invite.status; return <div className="collab-card" key={invite.id}><div className="collab-person"><strong>{invite.invitee_email}</strong><small>{invite.task_id ? 'Task invitation' : 'Contact invitation'} · {new Date(invite.created_at).toLocaleString()}</small></div><Status status={status}/>{status === 'expired' && <button className="text-btn" disabled={busy || !c.available} onClick={() => run(async () => { await c.act('resendEmailInvite', invite); setMessage(`A fresh invitation was sent to ${invite.invitee_email}.`); })}>Send again</button>}</div>; })}</div></section>}
    {groups.map(([title, rows]) => <section className="task-section" key={title}><div className="section-row"><h2>{title}</h2><span>{rows.length}</span></div>
      <div className="collab-list">{rows.length ? rows.map(row => { const other = row.requester_id === c.uid ? row.addressee_id : row.requester_id; const profile = c.profiles[other];
        return <div className="collab-card" key={row.id}><ProfileAvatar profile={profile} small/><div className="collab-person"><strong>{personName(profile)}</strong><small>{profile?.email}</small></div><Status status={row.status}/>
          {row.status === 'pending' && row.addressee_id === c.uid && <div className="collab-actions"><button className="primary" disabled={busy || !c.available} onClick={() => run(() => c.act('respondContact', row.id, 'accepted'))}>Accept</button><button className="secondary" disabled={busy || !c.available} onClick={() => run(() => c.act('respondContact', row.id, 'declined'))}>Decline</button></div>}
          {row.status === 'pending' && row.requester_id === c.uid && <button className="text-btn danger-text" disabled={busy || !c.available} onClick={() => closeConnection(row)}>Cancel request</button>}
          {row.status === 'accepted' && <button className="text-btn danger-text" disabled={busy || !c.available} onClick={() => closeConnection(row)}><UserMinus size={14}/> Remove contact</button>}
        </div>;
      }) : <p className="empty-line">{c.loading ? 'Loading…' : 'No contacts in this section yet.'}</p>}</div>
    </section>)}
  </>;
}

export function AssignmentPicker({ c, taskId, value, onChange, inviteEmail, onInviteEmail, disabled }) {
  const used = new Set(c.assignments.filter(a => String(a.task_id) === String(taskId) && ['pending', 'accepted'].includes(a.status)).map(a => a.assignee_id));
  const choices = c.contacts.filter(id => !used.has(id));
  return <fieldset className="assignment-picker"><legend>Share this task (optional)</legend><label>Assign to a contact<select value={value} onChange={e => { onChange(e.target.value); if (e.target.value) onInviteEmail(''); }} disabled={disabled || !c.available || Boolean(inviteEmail)}>
    <option value="">{taskId ? 'No new assignment' : 'Just me'}</option>
    {choices.map(id => <option key={id} value={id}>{personName(c.profiles[id])}{c.profiles[id]?.email ? ` · ${c.profiles[id].email}` : ''}</option>)}
  </select></label><div className="assign-divider"><span>or</span></div><label>Invite by email<input type="email" value={inviteEmail} onChange={e => { onInviteEmail(e.target.value); if (e.target.value) onChange(''); }} disabled={disabled || !c.available || Boolean(value)} placeholder="person@example.com"/></label><small className="field-help">{!c.online ? 'Reconnect to share a task.' : 'Accepted contacts receive it in-app. Anyone else can receive a secure join link by email, then accept or decline the task.'}</small></fieldset>;
}

export function AssignmentResponses({ c, assignment }) {
  const { busy, error, run } = useAction();
  const queued = c.outbox.find(item => item.method === 'respondAssignment' && item.args?.[0]?.id === assignment.id);
  return <><div className="collab-actions">{assignmentActions(assignment, c.uid).map(action => <button key={action} className={action === 'declined' ? 'secondary' : 'primary'} disabled={busy || c.loading || Boolean(queued)} onClick={() => run(() => c.act('respondAssignment', assignment, action))}>{action === 'accepted' ? 'Accept task' : action === 'declined' ? 'Decline task' : 'Complete assignment'}</button>)}</div>{queued && <p className="queued-change"><WifiOff size={14}/> {queued.args[1] === 'completed' ? 'Completion' : `${queued.args[1][0].toUpperCase()}${queued.args[1].slice(1)} response`} queued for sync. <button className="text-btn" onClick={() => c.discardOutbox(queued.id)}>Undo</button></p>}{error && <p role="alert" className="inline-error">{error}</p>}</>;
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

function OwnerAssignmentActions({ c, assignment }) {
  const { busy, error, run } = useAction();
  if (!['pending', 'accepted'].includes(assignment.status)) return null;
  const cancel = () => {
    if (!window.confirm('Cancel this assignment? The assignee will immediately lose access to the shared task.')) return;
    run(() => c.act('cancelAssignment', assignment.id));
  };
  return <><button className="text-btn danger-text" disabled={busy || !c.available} onClick={cancel}>Cancel assignment</button>{error && <p className="inline-error" role="alert">{error}</p>}</>;
}

export function AssignedByMeView({ c, tasks, onOpen }) {
  const [filter, setFilter] = useState('active');
  const owned = c.assignments.filter(assignment => assignment.owner_id === c.uid);
  const rows = owned.filter(assignment => filter === 'all' || (filter === 'active' ? ['pending', 'accepted'].includes(assignment.status) : assignment.status === filter));
  const filters = ['active', 'pending', 'accepted', 'completed', 'declined', 'cancelled', 'all'];
  return <><div className="page-head"><div><span className="eyebrow">FOLLOW THROUGH</span><h1>Assigned by me</h1><p>See every task you sent and withdraw access when plans change.</p></div><Send size={28}/></div>
    <div className="segmented">{filters.map(item => <button key={item} className={item === filter ? 'active' : ''} onClick={() => setFilter(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    <div className="collab-list assigned-list">{rows.map(assignment => { const task = tasks.find(row => String(row.id) === String(assignment.task_id)); return <article className="collab-task-card" key={assignment.id}>
      <div className="collab-card-head"><div><small>To {personName(c.profiles[assignment.assignee_id])}</small><h2><button className="collab-title" disabled={!task} onClick={() => task && onOpen(task)}>{task?.title || 'Task no longer available'}</button></h2></div><Status status={assignment.status}/></div>
      {task && <p className="collab-meta">{task.date ? `Due ${task.date}${task.time ? ` at ${task.time.slice(0, 5)}` : ''}` : 'No due date'} · {task.priority} priority{task.completed ? ' · You marked the task complete' : ''}</p>}
      <div className="owner-assignment-actions">{task && <button className="text-btn" onClick={() => onOpen(task)}><MessageCircle size={15}/> Open task & discussion</button>}<OwnerAssignmentActions c={c} assignment={assignment}/></div>
    </article>; })}{!rows.length && <div className="empty-state"><Send/><h3>{c.loading ? 'Loading assignments…' : 'No sent assignments here'}</h3><p>Tasks you assign to contacts will appear here with their latest response.</p></div>}</div>
  </>;
}

export function TaskCollaboration({ c, taskId }) {
  const { busy, error, run } = useAction();
  const rows = c.assignments.filter(a => String(a.task_id) === String(taskId));
  const invitations = c.emailInvites.filter(invite => String(invite.task_id) === String(taskId) && invite.status === 'pending');
  if (!rows.length && !invitations.length) return null;
  return <section className="task-collaboration"><h3>Assignments</h3>{invitations.map(invite => <div className="collab-card" key={invite.id}><div className="collab-person"><strong>{invite.invitee_email}</strong><small>Waiting for them to join Daymark · expires {new Date(invite.expires_at).toLocaleString()}</small></div><Status status="invited"/><div className="collab-actions"><button className="text-btn" disabled={busy || !c.available} onClick={() => run(() => c.act('resendEmailInvite', invite))}>Resend</button><button className="text-btn danger-text" disabled={busy || !c.available} onClick={() => run(() => c.act('cancelEmailInvite', invite.id))}>Cancel</button></div></div>)}{rows.map(a => <div className="collab-card" key={a.id}><ProfileAvatar profile={c.profiles[a.assignee_id]} small/><div className="collab-person"><strong>{personName(c.profiles[a.assignee_id])}</strong><small>You own this task</small></div><Status status={a.status}/><OwnerAssignmentActions c={c} assignment={a}/></div>)}{error && <p className="inline-error" role="alert">{error}</p>}<p className="field-help">Assignment completion is separate from your task checkbox. Recurring tasks create a private next occurrence.</p>{rows.length > 0 && <><Comments c={c} taskId={taskId} assignments={rows}/><TaskActivity c={c} taskId={taskId}/></>}</section>;
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
  const queued = c.outbox.filter(item => item.method === 'addComment' && String(item.args?.[0]) === String(taskId));
  return <div className="collab-comments"><h3>Comments</h3><p className="field-help">Visible to people assigned to this task and its owner.</p>
    {readError && <p role="alert" className="inline-error">{readError}</p>}
    <div className="comment-list">{queued.map(item => <article className="queued-comment" key={item.id}><div><strong>You</strong><time>Waiting to sync</time></div><p>{item.args[1]}</p><button className="text-btn" onClick={() => c.discardOutbox(item.id)}>Remove</button></article>)}{rows.map(row => <article key={row.id}><div><strong>{row.author_id === c.uid ? 'You' : personName(c.profiles[row.author_id])}</strong><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></div><p>{row.body}</p></article>)}{!rows.length && !queued.length && !readError && <p className="collab-meta">{loading ? 'Loading comments…' : 'No comments yet.'}</p>}</div>
    {allowed ? <form onSubmit={e => { e.preventDefault(); run(async () => { await c.act('addComment', taskId, body); setBody(''); }); }}><label>Add a comment<textarea value={body} maxLength={2000} onChange={e => setBody(e.target.value)} disabled={busy}/></label><div className="collab-actions"><small>{body.length}/2,000</small><button className="primary" disabled={busy || !body.trim()}>{c.online ? 'Post comment' : 'Queue comment'}</button></div></form> : <p className="field-help">Comments can be added after an assignment is accepted.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}

const activityText = {
  assigned: 'assigned this task', accepted: 'accepted the task', declined: 'declined the task',
  completed: 'completed the assignment', cancelled: 'cancelled the assignment', commented: 'added a comment',
  task_updated: 'updated the task', owner_completed: 'marked the task complete',
};

function TaskActivity({ c, taskId }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    c.api.activity(taskId).then(data => { if (!cancelled) { setRows(data); setError(''); setLoading(false); } }).catch(err => { if (!cancelled) { setRows([]); setError(err.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [c.api, c.revision, taskId]);
  return <div className="task-activity"><h3><Activity size={16}/> Activity</h3>{error && <p className="inline-error" role="alert">{error}</p>}<div className="activity-list">{rows.map(row => <article key={row.id}><span className="activity-dot"/><div><p><strong>{row.actor_id === c.uid ? 'You' : personName(c.profiles[row.actor_id])}</strong> {activityText[row.event_type] || row.event_type}.</p><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time></div></article>)}{!rows.length && !error && <p className="collab-meta">{loading ? 'Loading activity…' : 'No activity yet.'}</p>}</div></div>;
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
      <AssignmentResponses c={c} assignment={a}/><Comments c={c} taskId={a.task_id} assignments={[a]}/><TaskActivity c={c} taskId={a.task_id}/></> : <p>This assignment is no longer available.</p>}</div>
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
