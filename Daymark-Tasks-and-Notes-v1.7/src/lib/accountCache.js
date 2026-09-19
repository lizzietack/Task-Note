// Claim the old v1.4 device cache once, then keep every account in its own namespace.
export function migrateAccountCache(storage, userId, seedTasks = [], seedNotes = []) {
  const taskKey = `daymark.${userId}.tasks.v1`, noteKey = `daymark.${userId}.notes.v1`;
  if (storage.getItem(taskKey) !== null) return;
  const claim = storage.getItem('daymark.legacy-cache-owner.v1');
  const firstAccount = !claim || claim === userId;
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const tasks = firstAccount ? read('daily-organizer.tasks.v2', seedTasks.map(t => ({ ...t, id: crypto.randomUUID() }))) : [];
  const notes = firstAccount ? read('daily-organizer.notes.v2', seedNotes.map(n => ({ ...n, id: crypto.randomUUID() }))) : [];
  storage.setItem(taskKey, JSON.stringify(tasks)); storage.setItem(noteKey, JSON.stringify(notes));
  if (firstAccount) {
    storage.setItem('daymark.legacy-cache-owner.v1', userId);
    const queue = read('daymark.sync.delete-queue.v1', []);
    storage.setItem(`daymark.sync.delete-queue.v1.${userId}`, JSON.stringify(queue));
  }
}
