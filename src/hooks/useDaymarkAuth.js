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
  const signUp = useCallback((email, password) => supabase.auth.signUp({ email, password }), []);
  const signOut = useCallback(() => supabase.auth.signOut(), []);
  return { session, authLoading, configured: isSupabaseConfigured, signIn, signUp, signOut };
}
