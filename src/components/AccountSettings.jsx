import React, { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

function friendlyEmailName(email = '') {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) || 'Daymark user';
}

export function accountDisplayName(profile, user) {
  return profile?.display_name?.trim() || user?.user_metadata?.display_name?.trim() || friendlyEmailName(user?.email);
}

function SettingsSection({ title, description, children }) {
  return <section className="settings-section"><div className="settings-copy"><h3>{title}</h3><p>{description}</p></div><div className="settings-control">{children}</div></section>;
}

export function ThemeSwitch({ dark, setDark, compact = false }) {
  return <button type="button" className={compact ? 'theme-toggle compact' : 'theme-toggle'} role="switch" aria-checked={dark} aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={() => setDark(!dark)}>
    <span className="theme-track" aria-hidden="true"><span/></span><span className="theme-label">{dark ? 'Dark' : 'Light'}</span>
  </button>;
}

export function AccountSettings({ auth, profile, dark, setDark, onSaved, onClose }) {
  const dialogRef = useRef(null);
  const [name, setName] = useState(() => accountDisplayName(profile, auth.session.user));
  const [email, setEmail] = useState(auth.session.user.email || '');
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('');
  const run = async (kind, action, success) => {
    if (busy) return;
    setBusy(kind); setMessage(''); setError('');
    try { await action(); setMessage(success); await onSaved?.(); }
    catch (err) { setError(err.message || 'Could not update your account. Please try again.'); }
    finally { setBusy(''); }
  };
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="overlay settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialogRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <div className="modal-head"><div><span className="eyebrow">ACCOUNT</span><h2 id="settings-title">Profile & settings</h2></div><button type="button" className="icon" aria-label="Close settings" onClick={onClose}><X/></button></div>
      <div className="settings-body">
        <div className="profile-summary"><div className="profile-avatar">{accountDisplayName(profile, auth.session.user).split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</div><div><strong>{accountDisplayName(profile, auth.session.user)}</strong><span>{auth.session.user.email}</span></div></div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {message && <p className="inline-success" role="status"><Check size={15}/>{message}</p>}
        <SettingsSection title="Display name" description="This is the name your Daymark contacts see.">
          <label>Name<input value={name} maxLength={80} autoComplete="name" onChange={event => setName(event.target.value)}/></label>
          <button type="button" className="secondary" disabled={Boolean(busy) || name.trim() === accountDisplayName(profile, auth.session.user)} onClick={() => run('name', () => auth.updateDisplayName(name), 'Your name has been updated.')}>{busy === 'name' ? 'Saving…' : 'Save name'}</button>
        </SettingsSection>
        <SettingsSection title="Email address" description="You may need to confirm the change from your inbox before it takes effect.">
          <label>Email<input type="email" value={email} autoComplete="email" onChange={event => setEmail(event.target.value)}/></label>
          <button type="button" className="secondary" disabled={Boolean(busy) || email.trim().toLowerCase() === auth.session.user.email?.toLowerCase()} onClick={() => run('email', () => auth.updateEmail(email), 'Check your inbox to confirm the new email address.')}>{busy === 'email' ? 'Sending…' : 'Update email'}</button>
        </SettingsSection>
        <SettingsSection title="Password" description="Choose a new password with at least eight characters.">
          <div className="settings-passwords"><label>New password<input type="password" value={password} autoComplete="new-password" minLength={8} onChange={event => setPassword(event.target.value)}/></label><label>Confirm password<input type="password" value={confirm} autoComplete="new-password" minLength={8} onChange={event => setConfirm(event.target.value)}/></label></div>
          <button type="button" className="secondary" disabled={Boolean(busy) || password.length < 8 || password !== confirm} onClick={() => run('password', async () => { if (password !== confirm) throw new Error('The passwords do not match.'); await auth.updatePassword(password); setPassword(''); setConfirm(''); }, 'Your password has been changed.')}>{busy === 'password' ? 'Updating…' : 'Change password'}</button>
        </SettingsSection>
        <SettingsSection title="Appearance" description="Use the theme that feels most comfortable."><ThemeSwitch dark={dark} setDark={setDark}/></SettingsSection>
        <section className="settings-signout"><div><h3>Sign out</h3><p>Your synced data remains available when you sign in again.</p></div><button type="button" className="signout-button" disabled={Boolean(busy)} onClick={() => run('signout', auth.signOut, 'Signed out.')}>Sign out of Daymark</button></section>
      </div>
    </div>
  </div>;
}
