import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

type EmailDelivery = {
  delivery_id: string;
  recipient_email: string;
  title: string;
  message: string;
};

type PushDelivery = {
  delivery_id: string;
  subscription_id: string;
  notification_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
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

    // The worker uses the publishable/anon key plus narrowly scoped RPCs. It does
    // not need the service-role key.
    const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [emailClaim, pushClaim] = await Promise.all([
      supabase.rpc('daymark_claim_notification_deliveries', { worker_secret: workerSecret, batch_limit: 25 }),
      supabase.rpc('daymark_claim_push_deliveries', { worker_secret: workerSecret, batch_limit: 50 }),
    ]);
    if (emailClaim.error) throw emailClaim.error;
    if (pushClaim.error) throw pushClaim.error;

    let emailSent = 0;
    let emailFailed = 0;
    for (const delivery of (emailClaim.data || []) as EmailDelivery[]) {
      let delivered = false;
      let providerId: string | null = null;
      let failureMessage: string | null = null;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env('RESEND_API_KEY')}`,
            'content-type': 'application/json',
            'idempotency-key': `jotrelay-notification/${delivery.delivery_id}`,
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
      if (delivered) emailSent += 1; else emailFailed += 1;
    }

    let pushSent = 0;
    let pushFailed = 0;
    let siteUrl = '';
    if ((pushClaim.data || []).length) {
      webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
      siteUrl = env('DAYMARK_SITE_URL');
    }
    for (const delivery of (pushClaim.data || []) as PushDelivery[]) {
      let delivered = false;
      let responseCode: number | null = null;
      let failureMessage: string | null = null;
      let expired = false;
      try {
        const destination = new URL(siteUrl);
        destination.searchParams.set('jotrelay_notification', delivery.notification_id);
        const response = await webpush.sendNotification({
          endpoint: delivery.endpoint,
          keys: { p256dh: delivery.p256dh, auth: delivery.auth },
        }, JSON.stringify({
          title: delivery.title,
          message: delivery.message,
          notificationId: delivery.notification_id,
          url: destination.toString(),
          tag: `jotrelay-${delivery.notification_id}`,
        }), {
          TTL: 60 * 60 * 24,
          urgency: 'high',
          topic: delivery.notification_id.replace(/-/g, '').slice(0, 32),
        });
        delivered = response.statusCode >= 200 && response.statusCode < 300;
        responseCode = response.statusCode;
      } catch (error) {
        const pushError = error as { statusCode?: number; message?: string; body?: string };
        responseCode = pushError.statusCode || null;
        expired = responseCode === 404 || responseCode === 410;
        failureMessage = pushError.message || pushError.body || 'Push delivery failed';
      }

      const finish = await supabase.rpc('daymark_finish_push_delivery', {
        worker_secret: workerSecret,
        target_delivery: delivery.delivery_id,
        delivered,
        response_code: responseCode,
        failure_message: failureMessage,
        subscription_expired: expired,
      });
      if (finish.error) throw finish.error;
      if (delivered) pushSent += 1; else pushFailed += 1;
    }

    return Response.json({
      email: { claimed: (emailClaim.data || []).length, sent: emailSent, failed: emailFailed },
      push: { claimed: (pushClaim.data || []).length, sent: pushSent, failed: pushFailed },
    });
  } catch (error) {
    console.error('JotRelay notification worker failed', error);
    return Response.json({ error: error instanceof Error ? error.message : 'Worker failed' }, { status: 500 });
  }
});
