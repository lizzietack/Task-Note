import { createClient } from 'npm:@supabase/supabase-js@2';

type Delivery = {
  delivery_id: string;
  recipient_email: string;
  title: string;
  message: string;
};

const env = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character] || character));

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const workerSecret = env('DAYMARK_DELIVERY_SECRET');
    if (request.headers.get('x-daymark-delivery-secret') !== workerSecret) {
      return new Response('Unauthorized', { status: 401 });
    }

    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc('daymark_claim_notification_deliveries', {
      worker_secret: workerSecret,
      batch_limit: 25,
    });
    if (error) throw error;

    let sent = 0;
    let failed = 0;
    for (const delivery of (data || []) as Delivery[]) {
      let delivered = false;
      let providerId: string | null = null;
      let failureMessage: string | null = null;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env('RESEND_API_KEY')}`,
            'content-type': 'application/json',
            'idempotency-key': `daymark-notification/${delivery.delivery_id}`,
          },
          body: JSON.stringify({
            from: env('DAYMARK_FROM_EMAIL'),
            to: [delivery.recipient_email],
            subject: delivery.title,
            html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#17211f"><h2>${escapeHtml(delivery.title)}</h2><p style="line-height:1.6">${escapeHtml(delivery.message)}</p><p><a href="${escapeHtml(env('DAYMARK_SITE_URL'))}" style="display:inline-block;background:#0f766e;color:white;text-decoration:none;padding:11px 16px;border-radius:8px">Open JotRelay</a></p><p style="font-size:12px;color:#66726f">You can change email notifications in Profile &amp; settings.</p></div>`,
          }),
        });
        const result = await response.json().catch(() => ({}));
        delivered = response.ok;
        providerId = typeof result.id === 'string' ? result.id : null;
        failureMessage = delivered ? null : String(result.message || `Email provider returned ${response.status}`);
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : 'Email delivery failed';
      }

      const finish = await supabase.rpc('daymark_finish_notification_delivery', {
        worker_secret: workerSecret,
        target_delivery: delivery.delivery_id,
        delivered,
        external_id: providerId,
        failure_message: failureMessage,
      });
      if (finish.error) throw finish.error;
      if (delivered) sent += 1; else failed += 1;
    }

    return Response.json({ claimed: (data || []).length, sent, failed });
  } catch (error) {
    console.error('JotRelay notification worker failed', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Worker failed' }, { status: 500 });
  }
});
