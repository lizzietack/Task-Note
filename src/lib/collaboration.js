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
export const personName = profile => profile?.display_name || profile?.email || 'Daymark user';

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
    if (!invitation?.invite_token || !invitation?.invite_id) throw new Error('Daymark could not create the secure invitation.');
    const redirect = new URL(window.location.origin);
    redirect.searchParams.set('daymark_invite', invitation.invite_token);
    const { error } = await client.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirect.toString(),
        data: { daymark_invitation: true, task_title: taskTitle || undefined },
      },
    });
    if (error) {
      try { await rpc('daymark_cancel_email_invite', { target_invite: invitation.invite_id }); } catch {}
      if (error.code === 'email_address_not_authorized' || /email address not authorized/i.test(error.message || '')) throw new Error('Email delivery is not configured for public invitations yet. Ask the Daymark administrator to enable custom SMTP in Supabase.');
      throw error;
    }
    return invitation;
  };
  return {
    invite: email => rpc('daymark_invite_contact', { invitee_email: email.trim() }),
    inviteAny: async email => {
      try { await rpc('daymark_invite_contact', { invitee_email: email.trim() }); return { delivery: 'in_app' }; }
      catch (error) {
        if (!/no daymark user found/i.test(error.message || '')) throw error;
        return { delivery: 'email', ...(await emailInvitation(email)) };
      }
    },
    inviteTaskByEmail: (email, taskId, taskTitle) => emailInvitation(email, taskId, taskTitle),
    cancelEmailInvite: id => rpc('daymark_cancel_email_invite', { target_invite: id }),
    claimEmailInvite: token => rpc('daymark_claim_email_invite', { invite_token: token }),
    respondContact: (id, response) => {
      if (!['accepted', 'declined'].includes(response)) throw new Error('Invalid response');
      return rpc('daymark_respond_contact', { target_connection: id, response });
    },
    assign: (taskId, user) => rpc('daymark_assign_task', { target_task: String(taskId), target_user: user }),
    respondAssignment: (assignment, response) => {
      if (!assignmentActions(assignment, userId).includes(response)) throw new Error('This action is no longer available. Refresh and try again.');
      return response === 'completed'
        ? rpc('daymark_complete_assignment', { target_assignment: assignment.id })
        : rpc('daymark_respond_assignment', { target_assignment: assignment.id, response });
    },
    comments: taskId => allRows(() => client.from('task_comments').select('*').eq('task_id', String(taskId)).order('created_at').order('id')),
    addComment: (taskId, body) => {
      const text = body.trim();
      if (!text || [...text].length > 2000) throw new Error('Comments must contain 1–2,000 characters.');
      return checked(client.from('task_comments').insert({ task_id: String(taskId), author_id: userId, body: text }));
    },
    markRead: id => checked(client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).eq('id', id).is('read_at', null)),
    markAllRead: () => checked(client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null)),
  };
}
