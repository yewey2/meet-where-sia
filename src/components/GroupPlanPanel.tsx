import { useState, type FormEvent, type ReactNode } from 'react';
import type { SharedMember, SharedPlan } from '../lib/groupPlans';
import './GroupPlanPanel.css';

export interface CreatePlanInput {
  title: string;
  displayName: string;
  email: string;
  password: string;
}

interface GroupPlanPanelProps {
  plan: SharedPlan | null;
  requestedPlanId: string | null;
  accessRequired: boolean;
  busy: boolean;
  syncLabel: string;
  error: string;
  onCreate: (input: CreatePlanInput) => Promise<void>;
  onLogin: (email: string, password: string) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onAddMember: (input: { displayName: string; email: string; temporaryPassword: string }) => Promise<void>;
  onResetMember: (memberId: string, temporaryPassword: string) => Promise<void>;
  onRemoveMember: (member: SharedMember) => Promise<void>;
  onChangePassword: (password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDismissError: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="group-field"><span>{label}</span>{children}</label>;
}

export function GroupPlanPanel(props: GroupPlanPanelProps) {
  const [dialog, setDialog] = useState<'create' | 'manage' | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [title, setTitle] = useState('Weekend meetup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const owner = props.plan?.currentMember.role === 'owner';

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    await props.onLogin(loginEmail, loginPassword);
    setLoginPassword('');
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    await props.onCreate({ title, displayName, email, password });
    setPassword('');
    setDialog('manage');
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    await props.onAddMember({
      displayName: memberName,
      email: memberEmail,
      temporaryPassword: memberPassword,
    });
    setMemberName('');
    setMemberEmail('');
    setMemberPassword('');
  }

  if (props.accessRequired && props.requestedPlanId) {
    return (
      <div className="group-access-page">
        <section className="group-access-card" aria-labelledby="group-access-title">
          <div className="group-lock" aria-hidden="true">MW</div>
          <p className="group-kicker">Private group plan</p>
          <h1 id="group-access-title">Sign in to plan together.</h1>
          <p>Use the email and temporary password the plan owner shared with you.</p>
          <form onSubmit={(event) => void submitLogin(event)}>
            <Field label="Email">
              <input type="email" autoComplete="email" required value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} />
            </Field>
            <Field label="Password">
              <input type="password" autoComplete="current-password" minLength={10} required value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
            </Field>
            {props.error ? <p className="group-error" role="alert">{props.error}</p> : null}
            <button className="group-primary" type="submit" disabled={props.busy}>
              {props.busy ? 'Signing in…' : 'Open shared plan'}
            </button>
          </form>
          <a className="group-local-link" href="/">Start a separate plan instead</a>
        </section>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={props.plan ? 'group-plan-button is-shared' : 'group-plan-button'}
        onClick={() => setDialog(props.plan ? 'manage' : 'create')}
      >
        <span className="group-plan-dot" />
        <span>{props.plan ? 'Shared plan · Manage' : 'Make this a shared plan'}</span>
        {props.plan ? <small>{props.syncLabel}</small> : null}
      </button>

      {dialog ? (
        <div className="group-dialog-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="group-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="group-dialog-close" type="button" aria-label="Close" onClick={() => setDialog(null)}>×</button>

            {dialog === 'create' ? (
              <>
                <p className="group-kicker">Persistent and private</p>
                <h2 id="group-dialog-title">Make this a shared plan</h2>
                <p className="group-dialog-copy">Your current people and routes are copied into a link your group can keep updating.</p>
                <form onSubmit={(event) => void submitCreate(event)}>
                  <Field label="Plan name"><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                  <div className="group-field-row">
                    <Field label="Your name"><input autoComplete="name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
                    <Field label="Your email"><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  </div>
                  <Field label="Your password"><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <small className="group-hint">At least 10 characters. Passwords are never stored in plaintext.</small>
                  {props.error ? <p className="group-error" role="alert">{props.error}</p> : null}
                  <button className="group-primary" type="submit" disabled={props.busy}>{props.busy ? 'Creating…' : 'Create private link'}</button>
                </form>
              </>
            ) : props.plan ? (
              <>
                <p className="group-kicker">Shared plan</p>
                <h2 id="group-dialog-title">{props.plan.title}</h2>
                <div className="group-share-row">
                  <input aria-label="Share link" readOnly value={window.location.href} />
                  <button type="button" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}>{copied ? 'Copied' : 'Copy invite link'}</button>
                </div>
                <p className="group-hint">The link identifies the plan; every person still needs their own email and password.</p>

                {owner ? (
                  <div className="group-owner-tools">
                    <form className="group-inline-form" onSubmit={(event) => { event.preventDefault(); void props.onRename(title || props.plan!.title); }}>
                      <Field label="Plan name"><input maxLength={100} defaultValue={props.plan.title} onChange={(event) => setTitle(event.target.value)} /></Field>
                      <button type="submit" disabled={props.busy}>Rename</button>
                    </form>
                    <h3>People with access</h3>
                    <ul className="group-member-list">
                      {props.plan.members.map((member) => (
                        <li key={member.id}>
                          <span><strong>{member.displayName}</strong><small>{member.email || 'Member'} · {member.role}</small></span>
                          {member.role !== 'owner' ? (
                            <span className="group-member-actions">
                              <button type="button" onClick={() => { const temporaryPassword = window.prompt(`New temporary password for ${member.displayName} (10+ characters)`); if (temporaryPassword) void props.onResetMember(member.id, temporaryPassword); }}>Reset password</button>
                              <button className="is-danger" type="button" onClick={() => { if (window.confirm(`Remove ${member.displayName}'s access?`)) void props.onRemoveMember(member); }}>Remove</button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <form className="group-add-member" onSubmit={(event) => void addMember(event)}>
                      <h3>Add a friend</h3>
                      <div className="group-field-row">
                        <Field label="Name"><input required value={memberName} onChange={(event) => setMemberName(event.target.value)} /></Field>
                        <Field label="Email"><input type="email" required value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} /></Field>
                      </div>
                      <Field label="Temporary password"><input type="password" minLength={10} required value={memberPassword} onChange={(event) => setMemberPassword(event.target.value)} /></Field>
                      <button type="submit" disabled={props.busy}>Add to plan</button>
                    </form>
                  </div>
                ) : (
                  <div className="group-member-summary"><strong>{props.plan.members.length} people can edit</strong><span>The owner manages access.</span></div>
                )}

                <form className="group-password-form" onSubmit={(event) => { event.preventDefault(); void props.onChangePassword(newPassword).then(() => setNewPassword('')); }}>
                  <Field label="Change my password"><input type="password" minLength={10} required placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
                  <button type="submit" disabled={props.busy}>Update</button>
                </form>
                {props.error ? <p className="group-error" role="alert"><button type="button" onClick={props.onDismissError}>×</button>{props.error}</p> : null}
                <div className="group-dialog-footer">
                  <button type="button" onClick={() => void props.onLogout()}>Sign out</button>
                  {owner ? <button className="is-danger" type="button" onClick={() => { if (window.confirm('Permanently delete this shared plan for everyone?')) void props.onDelete(); }}>Delete plan</button> : null}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}

