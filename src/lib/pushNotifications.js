import { supabase } from './supabase';

const publicKey = (import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY || '').trim();

export function pushAvailability() {
  const supported = typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
  const ios = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  return { supported, configured: Boolean(publicKey), ios, standalone };
}

export function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
}

async function registration() {
  const availability = pushAvailability();
  if (!availability.supported) throw new Error('Lock-screen notifications are not supported on this device.');
  if (!availability.configured) throw new Error('Lock-screen notifications are not configured for this JotRelay deployment yet.');
  if (availability.ios && !availability.standalone) {
    throw new Error('On iPhone or iPad, add JotRelay to your Home Screen first, then open the installed app and enable notifications here.');
  }
  return navigator.serviceWorker.ready;
}

export async function currentPushStatus() {
  const availability = pushAvailability();
  if (!availability.supported) return { ...availability, permission: 'unsupported', subscribed: false, anySubscribed: false };
  let subscription = null;
  try {
    const ready = await navigator.serviceWorker.ready;
    subscription = await ready.pushManager.getSubscription();
  } catch {}
  const result = await supabase.from('push_subscriptions').select('id', { count: 'exact', head: true });
  if (result.error) throw result.error;
  return { ...availability, permission: Notification.permission, subscribed: Boolean(subscription), anySubscribed: (result.count || 0) > 0 };
}

export async function enablePushNotifications(userId) {
  const availability = pushAvailability();
  if (availability.ios && !availability.standalone) {
    throw new Error('On iPhone or iPad, add JotRelay to your Home Screen first, then open the installed app and enable notifications here.');
  }
  if (!availability.supported) throw new Error('Lock-screen notifications are not supported on this device.');
  if (!availability.configured) throw new Error('Lock-screen notifications are not configured for this JotRelay deployment yet.');

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can enable them in this phone’s notification settings.');

  const ready = await registration();
  let subscription = await ready.pushManager.getSubscription();
  if (!subscription) {
    subscription = await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const serialized = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: serialized.keys?.p256dh,
    auth: serialized.keys?.auth,
    expiration_time: subscription.expirationTime,
    user_agent: navigator.userAgent.slice(0, 500),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) {
    await subscription.unsubscribe().catch(() => {});
    throw error;
  }
  return currentPushStatus();
}

export async function disablePushNotifications() {
  const availability = pushAvailability();
  if (!availability.supported) return { ...availability, permission: 'unsupported', subscribed: false, anySubscribed: false };
  const ready = await navigator.serviceWorker.ready;
  const subscription = await ready.pushManager.getSubscription();
  if (subscription) {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    if (error) throw error;
    await subscription.unsubscribe();
  }
  return currentPushStatus();
}

export async function syncPushSubscription(userId) {
  const availability = pushAvailability();
  if (!availability.supported || !availability.configured || Notification.permission !== 'granted') return;
  const ready = await navigator.serviceWorker.ready;
  const subscription = await ready.pushManager.getSubscription();
  if (!subscription) return;
  const serialized = subscription.toJSON();
  await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: serialized.keys?.p256dh,
    auth: serialized.keys?.auth,
    expiration_time: subscription.expirationTime,
    user_agent: navigator.userAgent.slice(0, 500),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
}
