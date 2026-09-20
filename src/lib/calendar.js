const escapeIcs = value => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const icsTimestamp = value => new Date(value || Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function buildCalendar(tasks, name = 'JotRelay tasks') {
  const events = tasks.filter(task => task.date).map(task => {
    const day = task.date.replaceAll('-', '');
    const time = task.time ? task.time.replaceAll(':', '').slice(0, 6).padEnd(6, '0') : '';
    return [
      'BEGIN:VEVENT',
      `UID:${escapeIcs(task.id)}@getjotrelay.com`,
      `DTSTAMP:${icsTimestamp(task.updatedAt || task.createdAt)}`,
      `${time ? 'DTSTART' : 'DTSTART;VALUE=DATE'}:${day}${time ? `T${time}` : ''}`,
      `SUMMARY:${escapeIcs(task.title)}${task.completed ? ' [Completed]' : ''}`,
      task.note ? `DESCRIPTION:${escapeIcs(task.note)}` : '',
      'END:VEVENT',
    ].filter(Boolean).join('\r\n');
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JotRelay//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeIcs(name)}`, ...events, 'END:VCALENDAR', ''].join('\r\n');
}

export function downloadCalendar(tasks) {
  const blob = new Blob([buildCalendar(tasks)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jotrelay-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function calendarFeedUrl(token) {
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  return `${base}/functions/v1/jotrelay-calendar-feed?token=${encodeURIComponent(token)}`;
}
