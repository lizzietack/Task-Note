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
  return {
    invite: email => rpc('daymark_invite_contact', { invitee_email: email.trim() }),
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
