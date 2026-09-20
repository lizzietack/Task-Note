import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function useDaymarkAuth() {
  const [session, setSession] = useState(null), [authLoading, setLoading] = useState(true);
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    let active = true, changed = false;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      changed = true; if (active) { setSession(next); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data }) => { if (active && !changed) { setSession(data.session); setLoading(false); } })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const signIn = useCallback((email, password) => supabase.auth.signInWithPassword({ email, password }), []);
  const signInWithGoogle = useCallback(() => {
    const redirect = new URL(window.location.href);
    redirect.hash = '';
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect.toString() },
    });
  }, []);
  const signUp = useCallback((email, password, displayName) => supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName.trim() } },
  }), []);
  const signOut = useCallback(() => supabase.auth.signOut(), []);
  const updateDisplayName = useCallback(async displayName => {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 80) throw new Error('Enter a name between 2 and 80 characters.');
    const { error: authError } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (authError) throw authError;
    if (!session?.user?.id) throw new Error('Your session has expired. Sign in and try again.');
    const { error: profileError } = await supabase.from('profiles').update({ display_name: name, updated_at: new Date().toISOString() }).eq('id', session.user.id);
    if (profileError) throw profileError;
    return name;
  }, [session?.user?.id]);
  const updateEmail = useCallback(async email => {
    const next = email.trim().toLowerCase();
    if (!next || next === session.user.email?.toLowerCase()) throw new Error('Enter a different email address.');
    const { data, error } = await supabase.auth.updateUser({ email: next });
    if (error) throw error;
    return data;
  }, [session?.user?.email]);
  const updatePassword = useCallback(async password => {
    if (password.length < 8) throw new Error('Use at least 8 characters.');
    const { error } = await supabase.auth.updateUser({ password, data: { daymark_password_created: true } });
    if (error) throw error;
  }, []);
  const updateTimezone = useCallback(async timezone => {
    const value = timezone.trim();
    if (!session?.user?.id) throw new Error('Your session has expired. Sign in and try again.');
    if (!value || value.length > 80) throw new Error('Choose a valid timezone.');
    try { new Intl.DateTimeFormat(undefined, { timeZone: value }).format(); }
    catch { throw new Error('Use a valid timezone such as Africa/Accra or Europe/London.'); }
    const { error } = await supabase.from('profiles').update({ timezone: value, updated_at: new Date().toISOString() }).eq('id', session.user.id);
    if (error) throw error;
    return value;
  }, [session?.user?.id]);
  const requestPasswordReset = useCallback(async email => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error('Enter your email address first.');
    const redirect = new URL(window.location.origin);
    redirect.searchParams.set('daymark_password_reset', '1');
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: redirect.toString() });
    if (error) throw error;
  }, []);
  const updateAvatar = useCallback(async file => {
    if (!session?.user?.id) throw new Error('Your session has expired. Sign in and try again.');
    if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.');
    const path = `${session.user.id}/avatar`;
    const { error: uploadError } = await supabase.storage.from('daymark-avatars').upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('daymark-avatars').getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
    const { error: profileError } = await supabase.from('profiles').update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() }).eq('id', session.user.id);
    if (profileError) throw profileError;
    const { error: authError } = await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });
    if (authError) throw authError;
    return avatarUrl;
  }, [session?.user?.id]);
  const removeAvatar = useCallback(async () => {
    if (!session?.user?.id) throw new Error('Your session has expired. Sign in and try again.');
    const path = `${session.user.id}/avatar`;
    const { error: removeError } = await supabase.storage.from('daymark-avatars').remove([path]);
    if (removeError && !/not found/i.test(removeError.message || '')) throw removeError;
    const { error: profileError } = await supabase.from('profiles').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', session.user.id);
    if (profileError) throw profileError;
    const { error: authError } = await supabase.auth.updateUser({ data: { avatar_url: null } });
    if (authError) throw authError;
  }, [session?.user?.id]);
  return { session, authLoading, configured: isSupabaseConfigured, signIn, signInWithGoogle, signUp, signOut, updateDisplayName, updateEmail, updatePassword, updateTimezone, requestPasswordReset, updateAvatar, removeAvatar };
}
