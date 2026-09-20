import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const escapeIcs = (value = '') => String(value)
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const stamp = (date: string, time?: string | null) => {
  if (!time) return date.replaceAll('-', '');
  return `${date.replaceAll('-', '')}T${time.replaceAll(':', '').slice(0, 6).padEnd(6, '0')}`;
};

Deno.serve(async request => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const token = new URL(request.url).searchParams.get('token')?.trim() || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) return new Response('Calendar feed not found', { status: 404 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.rpc('daymark_calendar_feed', { feed_token: token });
  if (error) return new Response('Calendar feed unavailable', { status: 503 });

  const events = (data || []).map((task: Record<string, unknown>) => {
    const date = String(task.task_date || '');
    const time = task.task_time ? String(task.task_time) : null;
    const start = stamp(date, time);
    const lines = [
      'BEGIN:VEVENT',
      `UID:${escapeIcs(task.id as string)}@getjotrelay.com`,
      `DTSTAMP:${new Date(task.updated_at as string).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
      `${time ? 'DTSTART' : 'DTSTART;VALUE=DATE'}:${start}`,
      `SUMMARY:${escapeIcs(task.title as string)}${task.completed ? ' [Completed]' : ''}`,
    ];
    if (task.note) lines.push(`DESCRIPTION:${escapeIcs(task.note as string)}`);
    lines.push('END:VEVENT');
    return lines.join('\r\n');
  });
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JotRelay//Tasks//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR', ''].join('\r\n');
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="jotrelay.ics"',
      'cache-control': 'private, max-age=300',
    },
  });
});
