import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { acceptedContacts, allRows, checked, collaborationApi } from '../lib/collaboration';

export const defaultNotificationPreferences = {
  contact_updates: true,
  assignment_updates: true,
  comment_updates: true,
  task_reminders: true,
  browser_notifications: true,
  push_notifications: false,
  email_notifications: false,
};

const empty = { connections: [], assignments: [], emailInvites: [], sharedTasks: [], sharedLists: [], sharedListMembers: [], profiles: {}, notifications: [], unread: 0, preferences: defaultNotificationPreferences };
const OUTBOX_PREFIX = 'daymark.collaboration-outbox.v1.';

function readOutbox(uid) {
  try {
    const saved = JSON.parse(localStorage.getItem(`${OUTBOX_PREFIX}${uid}`) || '[]');
    return Array.isArray(saved) ? saved : [];
  }
  catch { return []; }
}

function isNetworkError(error) {
  return !navigator.onLine || /failed to fetch|network|load failed|connection/i.test(error?.message || '');
}

function useReliableOutbox(uid, api, refresh) {
  const queue = useRef(null);
  const flushing = useRef(false);
  const [, render] = useState(0);
  if (!queue.current || queue.current.uid !== uid) {
    queue.current = { uid, items: readOutbox(uid) };
    flushing.current = false;
  }
  const persist = useCallback(next => {
    try { localStorage.setItem(`${OUTBOX_PREFIX}${uid}`, JSON.stringify(next)); } catch {}
    // A sign-out can finish while an older request is still resolving. Keep its
    // result in that account's storage without replacing the new account's UI.
    if (queue.current.uid !== uid) return;
    queue.current.items = next;
    render(value => value + 1);
  }, [uid]);
  const enqueue = useCallback(operation => {
    if (queue.current.items.some(item => item.id === operation.id)) return;
    persist([...queue.current.items, operation]);
  }, [persist]);
  const invoke = useCallback(operation => {
    if (operation.method === 'addComment') return api.addComment(operation.args[0], operation.args[1], operation.args[2] || [], operation.id);
    if (operation.method === 'respondAssignment') return api.respondAssignment(operation.args[0], operation.args[1]);
    throw new Error('Unsupported queued collaboration action');
  }, [api]);
  const flushOutbox = useCallback(async () => {
    if (flushing.current || !navigator.onLine || !queue.current.items.length) return;
    flushing.current = true;
    const pending = [];
    for (const operation of queue.current.items) {
      try { await invoke(operation); }
      catch (error) { pending.push({ ...operation, attempts: (operation.attempts || 0) + 1, lastError: error.message || 'Could not sync' }); }
    }
    persist(pending);
    flushing.current = false;
    await refresh();
  }, [invoke, persist, refresh]);
  useEffect(() => {
    const online = () => flushOutbox();
    window.addEventListener('online', online);
    if (navigator.onLine) flushOutbox();
    return () => window.removeEventListener('online', online);
  }, [flushOutbox]);
  const execute = useCallback(async (method, args) => {
    const operation = { id: crypto.randomUUID(), method, args, createdAt: Date.now(), attempts: 0 };
    if (!navigator.onLine) { enqueue(operation); return { queued: true, operationId: operation.id }; }
    try { return await invoke(operation); }
    catch (error) {
      if (!isNetworkError(error)) throw error;
      enqueue({ ...operation, lastError: error.message || 'Connection interrupted' });
      return { queued: true, operationId: operation.id };
    }
  }, [enqueue, invoke]);
  const discardOutbox = useCallback(id => persist(queue.current.items.filter(item => item.id !== id)), [persist]);
  return { outbox: queue.current.items, execute, flushOutbox, discardOutbox };
}

async function optionalEmailInvites(uid) {
  try {
    return await allRows(() => supabase.from('daymark_email_invites').select('id,invitee_email,task_id,status,created_at,expires_at').eq('inviter_id', uid).order('created_at', { ascending: false }));
  } catch (error) {
    if (['42P01', 'PGRST205'].includes(error?.code) || /daymark_email_invites.*(does not exist|schema cache)/i.test(error?.message || '')) return [];
    throw error;
  }
}

async function optionalPreferences(uid) {
  try {
    const rows = await checked(supabase.from('notification_preferences').select('*').eq('user_id', uid).limit(1));
    return { ...defaultNotificationPreferences, ...(rows[0] || {}) };
  } catch (error) {
    if (['42P01', 'PGRST205'].includes(error?.code) || /notification_preferences.*(does not exist|schema cache)/i.test(error?.message || '')) return defaultNotificationPreferences;
    throw error;
  }
}

export function useCollaboration(session) {
  const uid = session.user.id;
  const [data, setData] = useState(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [realtime, setRealtime] = useState('connecting');
  const [revision, setRevision] = useState(0);
  const active = useRef(false);
  const request = useRef(0);
  const api = useMemo(() => collaborationApi(supabase, uid), [uid]);
  const refresh = useCallback(async () => {
    const ticket = ++request.current;
    if (!navigator.onLine) return;
    try {
      const [connections, assignments, emailInvites, notifications, unreadResult, preferences, sharedLists, sharedListMembers] = await Promise.all([
        allRows(() => supabase.from('connections').select('*').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`).order('id')),
        allRows(() => supabase.from('task_assignments').select('*').or(`owner_id.eq.${uid},assignee_id.eq.${uid}`).order('id')),
        optionalEmailInvites(uid),
        checked(supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(100)),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null),
        optionalPreferences(uid),
        allRows(() => supabase.from('shared_task_lists').select('*').order('created_at').order('id')),
        allRows(() => supabase.from('shared_list_members').select('*').order('created_at').order('list_id')),
      ]);
      if (unreadResult.error) throw unreadResult.error;
      const ids = [...new Set(assignments.filter(a => a.assignee_id === uid && ['pending', 'accepted', 'completed'].includes(a.status)).map(a => a.task_id))];
      const people = [...new Set([uid, ...connections.flatMap(c => [c.requester_id, c.addressee_id]), ...assignments.flatMap(a => [a.owner_id, a.assignee_id]), ...sharedLists.map(list => list.owner_id), ...sharedListMembers.map(member => member.user_id)])];
      const sharedTasks = [], profiles = [];
      // Chunk IN filters to keep request URLs bounded for larger contact/task lists.
      for (let i = 0; i < ids.length; i += 100) sharedTasks.push(...await allRows(() => supabase.from('tasks').select('*').in('id', ids.slice(i, i + 100)).neq('user_id', uid).order('id')));
      for (let i = 0; i < people.length; i += 100) profiles.push(...await checked(supabase.from('profiles').select('*').in('id', people.slice(i, i + 100))));
      if (!active.current || ticket !== request.current) return;
      setData({ connections, assignments, emailInvites, sharedTasks, sharedLists, sharedListMembers, profiles: Object.fromEntries(profiles.map(p => [p.id, p])), notifications, unread: unreadResult.count || 0, preferences });
      setError(''); setRevision(r => r + 1);
    } catch (err) {
      if (active.current && ticket === request.current) setError(err.message || 'Collaboration could not refresh. Try again.');
    } finally { if (active.current && ticket === request.current) setLoading(false); }
  }, [uid]);

  const reliable = useReliableOutbox(uid, api, refresh);
  const { execute, flushOutbox, discardOutbox, outbox } = reliable;

  useEffect(() => {
    active.current = true;
    let timer;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
    const connectivity = () => { setOnline(navigator.onLine); if (navigator.onLine) refresh(); };
    const focus = () => { if (document.visibilityState === 'visible') refresh(); };
    // The v1.4 Auth trigger did not populate email. Only update the signed-in profile.
    checked(supabase.from('profiles').update({ email: session.user.email }).eq('id', uid))
      .then(refresh).catch(err => { if (active.current) { setError(err.message); setLoading(false); } });
    const channel = supabase.channel(`daymark-collaboration-${uid}`);
    ['connections', 'task_assignments', 'task_comments', 'task_activity', 'tasks', 'profiles', 'daymark_email_invites', 'notification_preferences', 'shared_task_lists', 'shared_list_members', 'task_attachments', 'comment_mentions'].forEach(table =>
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule));
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, schedule)
      .subscribe(status => { if (active.current) { setRealtime(status === 'SUBSCRIBED' ? 'live' : 'reconnecting'); if (status === 'SUBSCRIBED') refresh(); } });
    // Also reconcile after missed events, revoked access, and reconnects.
    const fallback = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', focus);
    return () => {
      active.current = false; ++request.current; clearTimeout(timer); clearInterval(fallback);
      window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', focus); supabase.removeChannel(channel);
    };
  }, [uid, session.user.email, refresh]);

  const act = useCallback(async (method, ...args) => {
    if (method === 'addComment' || method === 'respondAssignment') {
      const result = await execute(method, args);
      if (navigator.onLine) await refresh();
      return result;
    }
    if (!navigator.onLine) throw new Error('Reconnect to use collaboration. Your personal tasks and notes still work offline.');
    // Reconcile even on failure: another device may have handled the request,
    // or the server may have committed before the response was interrupted.
    try { return await api[method](...args); }
    finally { await refresh(); }
  }, [api, execute, refresh]);
  return { ...data, uid, api, act, refresh, error, loading, online, realtime, revision, outbox, flushOutbox, discardOutbox,
    contacts: acceptedContacts(data.connections, uid), available: online && !loading && !error };
}
