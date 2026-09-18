import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

const BUCKET = 'daymark-attachments';
const DELETE_QUEUE_KEY = 'daymark.sync.delete-queue.v1';
const IMPORT_KEY_PREFIX = 'daymark.cloud-imported.v1.';

const msToIso = value => value ? new Date(value).toISOString() : null;
const isoToMs = value => value ? new Date(value).getTime() : null;
const stamp = item => item?.updatedAt || item?.createdAt || 0;
const idText = value => String(value);

function taskToRow(task, userId) {
  return {
    id: idText(task.id), user_id: userId, title: task.title || '', completed: Boolean(task.completed),
    date: task.date || null, time: task.time || null, priority: task.priority || 'medium',
    category: task.category || 'Personal', list_name: task.list || 'inbox', repeat_rule: task.repeat || 'none',
    reminder: task.reminder || 'None', note: task.note || '', subtasks: task.subtasks || [], source: task.source || { type: 'manual' },
    recurring_from: task.recurringFrom != null ? idText(task.recurringFrom) : null,
    created_at: msToIso(task.createdAt || Date.now()), updated_at: msToIso(task.updatedAt || task.createdAt || Date.now()),
    completed_at: msToIso(task.completedAt),
  };
}
function rowToTask(row) {
  return {
    id: row.id, title: row.title, completed: row.completed, date: row.date || '', time: row.time ? String(row.time).slice(0,5) : '',
    priority: row.priority, category: row.category, list: row.list_name, repeat: row.repeat_rule, reminder: row.reminder,
    note: row.note || '', subtasks: row.subtasks || [], source: row.source || { type: 'manual' }, recurringFrom: row.recurring_from || undefined,
    createdAt: isoToMs(row.created_at), updatedAt: isoToMs(row.updated_at), completedAt: isoToMs(row.completed_at),
  };
}
function noteToRow(note, userId) {
  return {
    id: idText(note.id), user_id: userId, title: note.title || '', body: note.body || '', note_type: note.type || 'text',
    pinned: Boolean(note.pinned), archived: Boolean(note.archived), label: note.label || 'Personal', color: note.color || 'plain',
    checklist: note.checklist || [], source: note.source || { type: 'manual' },
    attachment_ids: (note.attachments || []).map(a => idText(a.id)),
    created_at: msToIso(note.createdAt || Date.now()), updated_at: msToIso(note.updatedAt || note.createdAt || Date.now()),
  };
}
function rowToNote(row) {
  return {
    id: row.id, title: row.title, body: row.body || '', type: row.note_type || 'text', pinned: row.pinned, archived: row.archived,
    label: row.label || 'Personal', color: row.color || 'plain', checklist: row.checklist || [], attachments: [], source: row.source || { type: 'manual' },
    attachmentIds: row.attachment_ids || [], createdAt: isoToMs(row.created_at), updatedAt: isoToMs(row.updated_at),
  };
}
function attachmentToRow(a, noteId, userId, storagePath) {
  return {
    id: idText(a.id), user_id: userId, note_id: idText(noteId), name: a.name || 'Attachment', mime_type: a.type || 'application/octet-stream',
    size_bytes: a.size || 0, kind: a.kind || 'file', storage_path: storagePath, duration_seconds: a.duration || null,
  };
}
function mergeById(local, remote) {
  const merged = new Map();
  [...local, ...remote].forEach(item => {
    const key = idText(item.id); const current = merged.get(key);
    if (!current || stamp(item) >= stamp(current)) merged.set(key, item);
  });
  return [...merged.values()];
}
function getDeleteQueue() { try { return JSON.parse(localStorage.getItem(DELETE_QUEUE_KEY) || '[]'); } catch { return []; } }
function setDeleteQueue(q) { try { localStorage.setItem(DELETE_QUEUE_KEY, JSON.stringify(q)); } catch {} }
function safeName(name='file') { return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120); }

export function useDaymarkCloud({ tasks, setTasks, notes, setNotes }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncState, setSyncState] = useState('local');
  const [syncError, setSyncError] = useState('');
  const [lastSynced, setLastSynced] = useState(null);
  const hydratedRef = useRef(false);
  const syncingRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session || null); setAuthLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setAuthLoading(false); hydratedRef.current = false; });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback((email, password) => supabase.auth.signInWithPassword({ email, password }), []);
  const signUp = useCallback((email, password) => supabase.auth.signUp({ email, password }), []);
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const flushDeleteQueue = useCallback(async () => {
    if (!session?.user?.id || !navigator.onLine) return;
    const queue = getDeleteQueue(); if (!queue.length) return;
    const pending = [];
    for (const item of queue) {
      try {
        const table = item.type === 'task' ? 'tasks' : 'notes';
        const { error: tombError } = await supabase.from('deleted_items').upsert({ user_id: session.user.id, entity_type: item.type, entity_id: idText(item.id), deleted_at: new Date(item.at).toISOString() });
        if (tombError) throw tombError;
        if (item.type === 'note') {
          const { data: attachmentRows } = await supabase.from('attachments').select('storage_path').eq('user_id', session.user.id).eq('note_id', idText(item.id));
          const paths = (attachmentRows || []).map(a => a.storage_path).filter(Boolean);
          if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
        }
        const { error } = await supabase.from(table).delete().eq('id', idText(item.id)).eq('user_id', session.user.id);
        if (error) throw error;
      } catch { pending.push(item); }
    }
    setDeleteQueue(pending);
  }, [session]);

  const deleteEntity = useCallback(async (type, id) => {
    const entry = { type, id: idText(id), at: Date.now() };
    const q = getDeleteQueue(); if (!q.some(x => x.type === type && x.id === entry.id)) setDeleteQueue([...q, entry]);
    await flushDeleteQueue();
  }, [flushDeleteQueue]);

  const fetchCloud = useCallback(async () => {
    if (!session?.user?.id) return;
    const uid = session.user.id;
    const [{ data: taskRows, error: te }, { data: noteRows, error: ne }, { data: attRows, error: ae }, { data: tombRows, error: de }] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', uid),
      supabase.from('notes').select('*').eq('user_id', uid),
      supabase.from('attachments').select('*').eq('user_id', uid),
      supabase.from('deleted_items').select('*').eq('user_id', uid),
    ]);
    if (te || ne || ae || de) throw te || ne || ae || de;
    const tombs = new Set((tombRows || []).map(x => `${x.entity_type}:${x.entity_id}`));
    const cloudTasks = (taskRows || []).map(rowToTask).filter(x => !tombs.has(`task:${idText(x.id)}`));
    const cloudNotes = (noteRows || []).map(rowToNote).filter(x => !tombs.has(`note:${idText(x.id)}`));
    const attachmentMap = new Map();
    const paths = (attRows || []).map(a => a.storage_path).filter(Boolean);
    let signed = [];
    if (paths.length) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      signed = data || [];
    }
    (attRows || []).forEach((a, i) => {
      const entry = { id: a.id, name: a.name, type: a.mime_type, size: Number(a.size_bytes || 0), kind: a.kind, storagePath: a.storage_path, duration: a.duration_seconds, data: signed[i]?.signedUrl || '' };
      if (!attachmentMap.has(a.note_id)) attachmentMap.set(a.note_id, []);
      attachmentMap.get(a.note_id).push(entry);
    });
    const cloudWithAttachments = cloudNotes.map(n => ({ ...n, attachments: (attachmentMap.get(idText(n.id)) || []).filter(a => (n.attachmentIds || []).includes(idText(a.id))) }));
    return { cloudTasks, cloudNotes: cloudWithAttachments, tombs };
  }, [session]);

  const uploadAttachment = useCallback(async (note, a) => {
    if (!session?.user?.id) return a;
    if (a.storagePath) return a;
    if (!a.data?.startsWith('data:')) return a;
    const blob = await (await fetch(a.data)).blob();
    const path = `${session.user.id}/notes/${idText(note.id)}/${idText(a.id)}-${safeName(a.name)}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: a.type || blob.type });
    if (uploadError) throw uploadError;
    const { error: metaError } = await supabase.from('attachments').upsert(attachmentToRow(a, note.id, session.user.id, path));
    if (metaError) throw metaError;
    return { ...a, storagePath: path };
  }, [session]);

  const syncNow = useCallback(async () => {
    if (!session?.user?.id || !hydratedRef.current || syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true; setSyncState('syncing'); setSyncError('');
    try {
      await flushDeleteQueue();
      const uid = session.user.id;
      const taskRows = tasks.map(t => taskToRow(t, uid));
      const initialNoteRows = notes.map(n => noteToRow(n, uid));
      if (taskRows.length) { const { error } = await supabase.from('tasks').upsert(taskRows); if (error) throw error; }
      // Insert/update note rows before attachment metadata so the composite foreign key exists for new notes.
      if (initialNoteRows.length) { const { error } = await supabase.from('notes').upsert(initialNoteRows); if (error) throw error; }
      const noteCopies = [];
      for (const note of notes) {
        const attachments = [];
        for (const a of (note.attachments || [])) attachments.push(await uploadAttachment(note, a));
        noteCopies.push({ ...note, attachments });
      }
      const changedAttachments = noteCopies.some((n, i) => JSON.stringify(n.attachments) !== JSON.stringify(notes[i]?.attachments));
      if (changedAttachments) setNotes(noteCopies);
      setSyncState('synced'); setLastSynced(Date.now());
    } catch (error) {
      console.error('Daymark cloud sync failed', error); setSyncState('error'); setSyncError(error.message || 'Cloud sync failed. Your changes remain saved on this device.');
    } finally { syncingRef.current = false; }
  }, [session, tasks, notes, setNotes, flushDeleteQueue, uploadAttachment]);

  useEffect(() => {
    if (!session?.user?.id) { hydratedRef.current = false; setSyncState('local'); return; }
    let cancelled = false;
    (async () => {
      setSyncState('syncing'); setSyncError('');
      try {
        await flushDeleteQueue();
        const result = await fetchCloud(); if (cancelled) return;
        const filteredLocalTasks = tasks.filter(t => !result.tombs.has(`task:${idText(t.id)}`));
        const filteredLocalNotes = notes.filter(n => !result.tombs.has(`note:${idText(n.id)}`));
        const mergedTasks = mergeById(filteredLocalTasks, result.cloudTasks);
        const mergedNotes = mergeById(filteredLocalNotes, result.cloudNotes);
        setTasks(mergedTasks); setNotes(mergedNotes);
        hydratedRef.current = true;
        localStorage.setItem(`${IMPORT_KEY_PREFIX}${session.user.id}`, '1');
        setSyncState('synced'); setLastSynced(Date.now());
      } catch (error) {
        console.error('Daymark cloud bootstrap failed', error); hydratedRef.current = true; setSyncState('error'); setSyncError(error.message || 'Could not connect to Daymark Cloud. Local data is still available.');
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]); // intentionally bootstrap once per signed-in user

  useEffect(() => {
    if (!session?.user?.id || !hydratedRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(syncNow, 900);
    return () => clearTimeout(timerRef.current);
  }, [tasks, notes, session?.user?.id, syncNow]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const onOnline = () => syncNow(); window.addEventListener('online', onOnline);
    const channel = supabase.channel(`daymark-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${session.user.id}` }, () => setTimeout(async () => { try { const r = await fetchCloud(); setTasks(prev => mergeById(prev.filter(t=>!r.tombs.has(`task:${idText(t.id)}`)), r.cloudTasks)); } catch {} }, 250))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${session.user.id}` }, () => setTimeout(async () => { try { const r = await fetchCloud(); setNotes(prev => mergeById(prev.filter(n=>!r.tombs.has(`note:${idText(n.id)}`)), r.cloudNotes)); } catch {} }, 250))
      .subscribe();
    return () => { window.removeEventListener('online', onOnline); supabase.removeChannel(channel); };
  }, [session?.user?.id, fetchCloud, setTasks, setNotes, syncNow]);

  return { configured: isSupabaseConfigured, session, authLoading, signIn, signUp, signOut, syncState, syncError, lastSynced, syncNow, deleteEntity };
}
