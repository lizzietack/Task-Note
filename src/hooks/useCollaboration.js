import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { acceptedContacts, allRows, checked, collaborationApi } from '../lib/collaboration';

const empty = { connections: [], assignments: [], emailInvites: [], sharedTasks: [], profiles: {}, notifications: [], unread: 0 };

async function optionalEmailInvites(uid) {
  try {
    return await allRows(() => supabase.from('daymark_email_invites').select('id,invitee_email,task_id,status,created_at,expires_at').eq('inviter_id', uid).order('created_at', { ascending: false }));
  } catch (error) {
    if (['42P01', 'PGRST205'].includes(error?.code) || /daymark_email_invites.*(does not exist|schema cache)/i.test(error?.message || '')) return [];
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
      const [connections, assignments, emailInvites, notifications, unreadResult] = await Promise.all([
        allRows(() => supabase.from('connections').select('*').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`).order('id')),
        allRows(() => supabase.from('task_assignments').select('*').or(`owner_id.eq.${uid},assignee_id.eq.${uid}`).order('id')),
        optionalEmailInvites(uid),
        checked(supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(100)),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('read_at', null),
      ]);
      if (unreadResult.error) throw unreadResult.error;
      const ids = [...new Set(assignments.filter(a => a.assignee_id === uid && ['pending', 'accepted', 'completed'].includes(a.status)).map(a => a.task_id))];
      const people = [...new Set([uid, ...connections.flatMap(c => [c.requester_id, c.addressee_id]), ...assignments.flatMap(a => [a.owner_id, a.assignee_id])])];
      const sharedTasks = [], profiles = [];
      // Chunk IN filters to keep request URLs bounded for larger contact/task lists.
      for (let i = 0; i < ids.length; i += 100) sharedTasks.push(...await allRows(() => supabase.from('tasks').select('*').in('id', ids.slice(i, i + 100)).neq('user_id', uid).order('id')));
      for (let i = 0; i < people.length; i += 100) profiles.push(...await checked(supabase.from('profiles').select('*').in('id', people.slice(i, i + 100))));
      if (!active.current || ticket !== request.current) return;
      setData({ connections, assignments, emailInvites, sharedTasks, profiles: Object.fromEntries(profiles.map(p => [p.id, p])), notifications, unread: unreadResult.count || 0 });
      setError(''); setRevision(r => r + 1);
    } catch (err) {
      if (active.current && ticket === request.current) setError(err.message || 'Collaboration could not refresh. Try again.');
    } finally { if (active.current && ticket === request.current) setLoading(false); }
  }, [uid]);

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
    ['connections', 'task_assignments', 'task_comments', 'tasks', 'profiles', 'daymark_email_invites'].forEach(table =>
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
    if (!navigator.onLine) throw new Error('Reconnect to use collaboration. Your personal tasks and notes still work offline.');
    // Reconcile even on failure: another device may have handled the request,
    // or the server may have committed before the response was interrupted.
    try { return await api[method](...args); }
    finally { await refresh(); }
  }, [api, refresh]);
  return { ...data, uid, api, act, refresh, error, loading, online, realtime, revision,
    contacts: acceptedContacts(data.connections, uid), available: online && !loading && !error };
}
