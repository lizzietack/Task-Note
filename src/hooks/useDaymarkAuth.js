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
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  }, []);
  return { session, authLoading, configured: isSupabaseConfigured, signIn, signUp, signOut, updateDisplayName, updateEmail, updatePassword };
}
