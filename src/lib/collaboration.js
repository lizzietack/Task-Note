// These names and arguments match the existing text-task-id collaboration migration.
export const assignmentActions = (assignment, userId) => {
  if (!assignment || assignment.assignee_id !== userId) return [];
  return assignment.status === 'pending' ? ['accepted', 'declined']
    : assignment.status === 'accepted' ? ['completed'] : [];
};
export const canComment = (assignments, userId) => assignments.some(a =>
  ['accepted', 'completed'].includes(a.status) && (a.owner_id === userId || a.assignee_id === userId));
export const acceptedContacts = (connections, userId) => [...new Set(connections
  .filter(c => c.status === 'accepted' && [c.requester_id, c.addressee_id].includes(userId))
  .map(c => c.requester_id === userId ? c.addressee_id : c.requester_id))];
export const personName = profile => profile?.display_name || profile?.email || 'JotRelay user';
const ATTACHMENT_BUCKET = 'daymark-attachments';
const safeFileName = name => String(name || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);

export async function checked(query) {
  const result = await query;
  if (result.error) throw result.error;
  return result.data;
}

export async function allRows(makeQuery) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const page = await checked(makeQuery().range(start, start + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export function collaborationApi(client, userId) {
  const rpc = (name, args) => checked(client.rpc(name, args));
  const emailInvitation = async (email, taskId = null, taskTitle = '') => {
    const normalized = email.trim().toLowerCase();
    const response = await rpc('daymark_create_email_invite', { invitee_email: normalized, target_task: taskId ? String(taskId) : null });
    const invitation = Array.isArray(response) ? response[0] : response;
    if (!invitation?.invite_token || !invitation?.invite_id) throw new Error('JotRelay could not create the secure invitation.');
    const redirect = new URL(window.location.origin);
    redirect.searchParams.set('daymark_invite', invitation.invite_token);
    redirect.searchParams.set('daymark_setup', '1');
    const { error } = await client.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirect.toString(),
        data: { daymark_invitation: true, daymark_password_created: false, task_title: taskTitle || undefined },
      },
    });
    if (error) {
      try { await rpc('daymark_cancel_email_invite', { target_invite: invitation.invite_id }); } catch {}
      if (error.code === 'email_address_not_authorized' || /email address not authorized/i.test(error.message || '')) throw new Error('Email delivery is not configured for public invitations yet. Ask the JotRelay administrator to enable custom SMTP in Supabase.');
      throw error;
    }
    return invitation;
  };
  return {
    invite: email => rpc('daymark_invite_or_reconnect_contact', { invitee_email: email.trim() }),
    inviteAny: async email => {
      try { await rpc('daymark_invite_or_reconnect_contact', { invitee_email: email.trim() }); return { delivery: 'in_app' }; }
      catch (error) {
        if (!/no daymark user found/i.test(error.message || '')) throw error;
        return { delivery: 'email', ...(await emailInvitation(email)) };
      }
    },
    inviteTaskByEmail: (email, taskId, taskTitle) => emailInvitation(email, taskId, taskTitle),
    resendEmailInvite: invite => emailInvitation(invite.invitee_email, invite.task_id, invite.task_title || ''),
    cancelEmailInvite: id => rpc('daymark_cancel_email_invite', { target_invite: id }),
    claimEmailInvite: token => rpc('daymark_claim_email_invite', { invite_token: token }),
    respondContact: (id, response) => {
      if (!['accepted', 'declined'].includes(response)) throw new Error('Invalid response');
      return rpc('daymark_respond_contact', { target_connection: id, response });
    },
    closeConnection: id => rpc('daymark_close_connection', { target_connection: id }),
    assign: (taskId, user) => rpc('daymark_assign_or_reactivate_task', { target_task: String(taskId), target_user: user }),
    assignMany: (taskId, users = [], listId = null) => rpc('daymark_set_task_collaborators', {
      target_task: String(taskId), target_users: [...new Set(users)].filter(Boolean), target_list: listId || null,
    }),
    cancelAssignment: id => rpc('daymark_cancel_assignment', { target_assignment: id }),
    respondAssignment: (assignment, response) => {
      if (!assignmentActions(assignment, userId).includes(response)) throw new Error('This action is no longer available. Refresh and try again.');
      return rpc('daymark_set_assignment_status', { target_assignment: assignment.id, target_status: response });
    },
    comments: taskId => allRows(() => client.from('task_comments').select('*').eq('task_id', String(taskId)).order('created_at').order('id')),
    activity: taskId => checked(client.from('task_activity').select('*').eq('task_id', String(taskId)).order('created_at', { ascending: false }).limit(100)),
    addComment: (taskId, body, mentionsOrNonce = [], requestedNonce) => {
      const text = body.trim();
      if (!text || [...text].length > 2000) throw new Error('Comments must contain 1–2,000 characters.');
      const mentions = Array.isArray(mentionsOrNonce) ? mentionsOrNonce : [];
      const clientNonce = requestedNonce || (typeof mentionsOrNonce === 'string' ? mentionsOrNonce : crypto.randomUUID());
      return rpc('daymark_add_task_comment_v2', {
        target_task: String(taskId), comment_body: text, request_nonce: clientNonce,
        mentioned_users: [...new Set(mentions)].filter(Boolean),
      });
    },
    saveSharedList: (listId, name, members, color = 'mint') => rpc('daymark_save_shared_list', {
      target_list: listId || null, list_name: name.trim(), member_ids: [...new Set(members)].filter(Boolean), list_color: color,
    }),
    deleteSharedList: listId => rpc('daymark_delete_shared_list', { target_list: listId }),
    taskAttachments: async (taskId, ownerId) => {
      const rows = await allRows(() => client.from('task_attachments').select('*')
        .eq('task_id', String(taskId)).eq('owner_id', ownerId).order('created_at').order('id'));
      if (!rows.length) return [];
      const { data, error } = await client.storage.from(ATTACHMENT_BUCKET).createSignedUrls(rows.map(row => row.storage_path), 3600);
      if (error) throw error;
      return rows.map((row, index) => ({ ...row, url: data?.[index]?.signedUrl || '' }));
    },
    uploadTaskAttachment: async (taskId, ownerId, file) => {
      if (!file || file.size > 10 * 1024 * 1024) throw new Error('Each task attachment must be 10 MB or smaller.');
      const id = crypto.randomUUID();
      const path = `${ownerId}/tasks/${String(taskId)}/${id}-${safeFileName(file.name)}`;
      const { error: uploadError } = await client.storage.from(ATTACHMENT_BUCKET).upload(path, file, {
        upsert: false, contentType: file.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;
      const row = { id, task_id: String(taskId), owner_id: ownerId, uploader_id: userId, name: file.name || 'Attachment', mime_type: file.type || 'application/octet-stream', size_bytes: file.size || 0, storage_path: path };
      const { error: metadataError } = await client.from('task_attachments').insert(row);
      if (metadataError) { await client.storage.from(ATTACHMENT_BUCKET).remove([path]); throw metadataError; }
      return row;
    },
    deleteTaskAttachment: async attachment => {
      const { error: storageError } = await client.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path]);
      if (storageError) throw storageError;
      return checked(client.from('task_attachments').delete().eq('id', attachment.id));
    },
    getCalendarToken: (rotate = false) => rpc('daymark_get_calendar_token', { rotate }),
    deleteAccount: async confirmation => {
      if (confirmation !== 'DELETE') throw new Error('Type DELETE to confirm account deletion.');
      const [noteFiles, sharedFiles] = await Promise.all([
        allRows(() => client.from('attachments').select('storage_path').eq('user_id', userId).order('storage_path')),
        allRows(() => client.from('task_attachments').select('storage_path').or(`owner_id.eq.${userId},uploader_id.eq.${userId}`).order('storage_path')),
      ]);
      const attachmentPaths = [...new Set([...noteFiles, ...sharedFiles].map(row => row.storage_path).filter(Boolean))];
      for (let start = 0; start < attachmentPaths.length; start += 100) {
        const { error } = await client.storage.from(ATTACHMENT_BUCKET).remove(attachmentPaths.slice(start, start + 100));
        if (error && !/not found/i.test(error.message || '')) throw error;
      }
      const { error: avatarError } = await client.storage.from('daymark-avatars').remove([`${userId}/avatar`]);
      if (avatarError && !/not found/i.test(avatarError.message || '')) throw avatarError;
      return rpc('daymark_delete_account', { confirm_text: confirmation });
    },
    savePreferences: preferences => checked(client.from('notification_preferences').upsert({ user_id: userId, ...preferences, updated_at: new Date().toISOString() })),
    exportData: async () => {
      const [comments, activity, notifications, sharedLists, sharedListMembers, taskAttachments, commentMentions] = await Promise.all([
        allRows(() => client.from('task_comments').select('*').order('created_at').order('id')),
        allRows(() => client.from('task_activity').select('*').order('created_at').order('id')),
        allRows(() => client.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).order('id')),
        allRows(() => client.from('shared_task_lists').select('*').order('created_at').order('id')),
        allRows(() => client.from('shared_list_members').select('*').order('created_at').order('list_id')),
        allRows(() => client.from('task_attachments').select('*').order('created_at').order('id')),
        allRows(() => client.from('comment_mentions').select('*').order('created_at').order('comment_id')),
      ]);
      return { comments, activity, notifications, sharedLists, sharedListMembers, taskAttachments, commentMentions };
    },
    markRead: id => checked(client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id).is('read_at', null)),
    markAllRead: () => checked(client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)),
  };
}
