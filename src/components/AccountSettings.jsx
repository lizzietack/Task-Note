import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Download, Trash2, X } from 'lucide-react';

function friendlyEmailName(email = '') {
  return email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) || 'JotRelay user';
}

export function accountDisplayName(profile, user) {
  return profile?.display_name?.trim() || user?.user_metadata?.display_name?.trim() || friendlyEmailName(user?.email);
}

export function ProfileAvatar({ profile, user, small = false }) {
  const source = profile?.avatar_url || user?.user_metadata?.avatar_url || '';
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  const initials = accountDisplayName(profile, user).split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  return <span className={small ? 'profile-avatar small' : 'profile-avatar'}>{source && !failed ? <img src={source} alt="" onError={() => setFailed(true)}/> : initials}</span>;
}

function SettingsSection({ title, description, children }) {
  return <section className="settings-section"><div className="settings-copy"><h3>{title}</h3><p>{description}</p></div><div className="settings-control">{children}</div></section>;
}

export function ThemeSwitch({ dark, setDark, compact = false }) {
  return <button type="button" className={compact ? 'theme-toggle compact' : 'theme-toggle'} role="switch" aria-checked={dark} aria-label={dark ? 'Use light mode' : 'Use dark mode'} onClick={() => setDark(!dark)}>
    <span className="theme-track" aria-hidden="true"><span/></span><span className="theme-label">{dark ? 'Dark' : 'Light'}</span>
  </button>;
}

export function AccountSettings({ auth, collaboration, profile, dark, setDark, onExport, onSaved, onClose }) {
  const dialogRef = useRef(null);
  const photoRef = useRef(null);
  const [name, setName] = useState(() => accountDisplayName(profile, auth.session.user));
  const [email, setEmail] = useState(auth.session.user.email || '');
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [timezone, setTimezone] = useState(profile?.timezone || detectedTimezone);
  const [preferences, setPreferences] = useState(() => ({ ...collaboration.preferences }));
  const preferencesLoaded = useRef(!collaboration.loading);
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
  useEffect(() => {
    if (!preferencesLoaded.current && !collaboration.loading) {
      setPreferences({ ...collaboration.preferences });
      preferencesLoaded.current = true;
    }
  }, [collaboration.loading, collaboration.preferences]);
  return <div className="overlay settings-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialogRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <div className="modal-head"><div><span className="eyebrow">ACCOUNT</span><h2 id="settings-title">Profile & settings</h2></div><button type="button" className="icon" aria-label="Close settings" onClick={onClose}><X/></button></div>
      <div className="settings-body">
        <div className="profile-summary"><ProfileAvatar profile={profile} user={auth.session.user}/><div><strong>{accountDisplayName(profile, auth.session.user)}</strong><span>{auth.session.user.email}</span></div></div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {message && <p className="inline-success" role="status"><Check size={15}/>{message}</p>}
        <SettingsSection title="Profile photo" description="Optional. Your contacts will see this image beside your name.">
          <input ref={photoRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) run('avatar', () => auth.updateAvatar(file), 'Your profile photo has been updated.'); event.target.value = ''; }}/>
          <div className="photo-actions"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => photoRef.current?.click()}><Camera size={16}/>{busy === 'avatar' ? 'Uploading…' : 'Choose photo'}</button>{(profile?.avatar_url || auth.session.user.user_metadata?.avatar_url) && <button type="button" className="text-btn danger-text" disabled={Boolean(busy)} onClick={() => run('remove-avatar', auth.removeAvatar, 'Your profile photo has been removed.')}><Trash2 size={15}/>{busy === 'remove-avatar' ? 'Removing…' : 'Remove photo'}</button>}</div>
          <small className="field-help">PNG, JPEG, WebP or GIF, up to 5 MB.</small>
        </SettingsSection>
        <SettingsSection title="Display name" description="This is the name your JotRelay contacts see.">
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
        <SettingsSection title="Timezone" description="Used for scheduled reminders when JotRelay is closed.">
          <label>Timezone<input value={timezone} maxLength={80} onChange={event => setTimezone(event.target.value)} placeholder="Africa/Accra"/></label>
          <div className="photo-actions"><button type="button" className="secondary" disabled={Boolean(busy) || timezone === profile?.timezone} onClick={() => run('timezone', () => auth.updateTimezone(timezone), 'Your timezone has been updated.')}>{busy === 'timezone' ? 'Saving…' : 'Save timezone'}</button><button type="button" className="text-btn" disabled={Boolean(busy) || timezone === detectedTimezone} onClick={() => setTimezone(detectedTimezone)}>Use this device</button></div>
        </SettingsSection>
        <SettingsSection title="Notifications" description="Choose which collaboration updates JotRelay should deliver.">
          <div className="settings-options">
            {[
              ['contact_updates','Contact requests'],
              ['assignment_updates','Assignments and status changes'],
              ['comment_updates','Task comments'],
              ['task_reminders','Scheduled task reminders'],
              ['browser_notifications','Browser notifications'],
              ['email_notifications','Email copies (useful when JotRelay is closed)'],
            ].map(([key,label]) => <label className="settings-check" key={key}><input type="checkbox" checked={Boolean(preferences[key])} onChange={event => setPreferences(current => ({ ...current, [key]: event.target.checked }))}/><span>{label}</span></label>)}
          </div>
          <button type="button" className="secondary" disabled={Boolean(busy) || !collaboration.available} onClick={() => run('notifications', async () => {
            if (preferences.browser_notifications && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
            await collaboration.act('savePreferences', preferences);
          }, 'Your notification preferences have been saved.')}>{busy === 'notifications' ? 'Saving…' : 'Save notification preferences'}</button>
          <small className="field-help">Email copies start after the optional notification worker is configured.</small>
        </SettingsSection>
        <SettingsSection title="Your data" description="Download a readable copy of the information stored in your JotRelay account.">
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => run('export', onExport, 'Your JotRelay export has been downloaded.')}><Download size={16}/>{busy === 'export' ? 'Preparing export…' : 'Download my data'}</button>
          <small className="field-help">The JSON export includes tasks, notes and collaboration records. Attachment details are included, but the files themselves remain in secure storage.</small>
        </SettingsSection>
        <SettingsSection title="Appearance" description="Use the theme that feels most comfortable."><ThemeSwitch dark={dark} setDark={setDark}/></SettingsSection>
        <section className="settings-signout"><div><h3>Sign out</h3><p>Your synced data remains available when you sign in again.</p></div><button type="button" className="signout-button" disabled={Boolean(busy)} onClick={() => run('signout', auth.signOut, 'Signed out.')}>Sign out of JotRelay</button></section>
      </div>
    </div>
  </div>;
}
