import React from 'react';
import { X } from 'lucide-react';

const updated = '20 September 2026';

export function LegalDocument({ kind, onClose }) {
  const privacy = kind === 'privacy';
  return <div className="overlay legal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="modal legal-modal" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <div className="modal-head"><div><span className="eyebrow">JOTRELAY</span><h2 id="legal-title">{privacy ? 'Privacy Policy' : 'Terms of Service'}</h2><small>Last updated {updated}</small></div><button className="icon" aria-label="Close legal document" onClick={onClose}><X/></button></div>
      <div className="legal-copy">{privacy ? <>
        <p>JotRelay stores the account information and content needed to provide tasks, notes and collaboration. This includes your email address, display name, optional profile photo, tasks, notes, files, contacts, comments, notification preferences and basic delivery records.</p>
        <h3>How information is used</h3><p>We use this information to sync your workspace, deliver invitations and notifications, protect accounts, and operate the service. We do not sell personal information.</p>
        <h3>Sharing and processors</h3><p>Task information is shared only with collaborators you or a list owner select. JotRelay uses Supabase for authentication, database and file storage, Vercel for application hosting, and configured email and Web Push providers for delivery.</p>
        <h3>Retention and control</h3><p>You can download a JSON copy of your data and permanently delete your account from Profile & settings. Deletion removes the authentication account and data linked to it, subject to short-lived operational backups and legally required retention.</p>
        <h3>Security and contact</h3><p>JotRelay uses account-level permissions and private storage. No internet service can guarantee absolute security. Privacy questions can be sent through the support contact published for JotRelay.</p>
      </> : <>
        <p>These terms govern your use of JotRelay. You must provide accurate account information, keep your password secure, and use the service lawfully.</p>
        <h3>Your content</h3><p>You retain ownership of content you create. You grant JotRelay the limited permission required to store, process and deliver that content to collaborators you select.</p>
        <h3>Acceptable use</h3><p>Do not misuse JotRelay, interfere with the service, attempt unauthorized access, distribute malicious content, or use invitations and notifications for spam or harassment.</p>
        <h3>Availability</h3><p>The service may change, experience interruptions, or discontinue features. Keep independent copies of information that is critical to you. JotRelay is provided without guarantees beyond those required by applicable law.</p>
        <h3>Ending use</h3><p>You may stop using JotRelay and delete your account at any time. We may restrict abusive or unlawful use. These terms and the Privacy Policy may be updated, with the current version displayed in the application.</p>
      </>}</div>
    </article>
  </div>;
}
