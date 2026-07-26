import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { SharedMember, SharedPlan } from '../lib/groupPlans';
import './GroupPlanPanel.css';
import './SharedPlanPanel.css';

export interface CreatePlanInput {
  title: string;
  displayName: string;
  email: string;
  password: string;
}

interface SharedPlanPanelProps {
  plan: SharedPlan | null;
  busy: boolean;
  syncLabel: string;
  error: string;
  onCreate: (input: CreatePlanInput) => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
  onJoin: (username: string, password: string) => Promise<void>;
  onOwnerLogin: (email: string, password: string) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onSetJoining: (enabled: boolean) => Promise<void>;
  onAddMember: (input: { participantId: string; temporaryPassword: string }) => Promise<void>;
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

export function SharedPlanPanel(props: SharedPlanPanelProps) {
  const [dialog, setDialog] = useState<'create' | 'manage' | null>(null);
  const [title, setTitle] = useState('Weekend meetup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const currentMember = props.plan?.currentMember ?? null;
  const owner = currentMember?.role === 'owner';
  const availableParticipants = useMemo(() => {
    if (!props.plan || !owner) return [];
    const assigned = new Set(props.plan.members.map((member) => member.participantId).filter(Boolean));
    return props.plan.participants.filter((participant) => participant.name.trim() && !assigned.has(participant.id));
  }, [owner, props.plan]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    await props.onCreate({ title, displayName, email, password });
    setPassword('');
    setDialog('manage');
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    await props.onLogin(username, accessPassword);
    setAccessPassword('');
  }

  async function submitJoin() {
    await props.onJoin(username, accessPassword);
    setAccessPassword('');
  }

  async function submitOwnerLogin(event: FormEvent) {
    event.preventDefault();
    await props.onOwnerLogin(ownerEmail, ownerPassword);
    setOwnerPassword('');
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!participantId) return;
    await props.onAddMember({ participantId, temporaryPassword: memberPassword });
    setParticipantId('');
    setMemberPassword('');
  }

  const buttonLabel = !props.plan
    ? 'Make this a shared plan'
    : owner
      ? 'Shared plan · Manage'
      : currentMember
        ? 'My shared route'
        : 'View or join plan';

  return (
    <>
      <button
        type="button"
        className={props.plan ? 'group-plan-button is-shared' : 'group-plan-button'}
        onClick={() => setDialog(props.plan ? 'manage' : 'create')}
      >
        <span className="group-plan-dot" />
        <span>{buttonLabel}</span>
        {props.plan ? <small>{currentMember ? props.syncLabel : 'View only'}</small> : null}
      </button>

      {dialog ? (
        <div className="group-dialog-backdrop" role="presentation" onMouseDown={() => setDialog(null)}>
          <section className="group-dialog" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="group-dialog-close" type="button" aria-label="Close" onClick={() => setDialog(null)}>×</button>

            {dialog === 'create' ? (
              <>
                <p className="group-kicker">Public to anyone with the link</p>
                <h2 id="group-dialog-title">Make this a shared plan</h2>
                <p className="group-dialog-copy">Friends can view without signing in. You remain the owner and manage who can edit.</p>
                <form onSubmit={(event) => void submitCreate(event).catch(() => undefined)}>
                  <Field label="Plan name"><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                  <div className="group-field-row">
                    <Field label="Your name"><input autoComplete="name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
                    <Field label="Owner email"><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  </div>
                  <Field label="Owner password"><input type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <small className="group-hint">At least 6 characters. Only the owner needs an email.</small>
                  {props.error ? <p className="group-error" role="alert">{props.error}</p> : null}
                  <button className="group-primary" type="submit" disabled={props.busy}>{props.busy ? 'Creating…' : 'Create shared plan'}</button>
                </form>
              </>
            ) : props.plan ? (
              <>
                <p className="group-kicker">Shared plan</p>
                <h2 id="group-dialog-title">{props.plan.title}</h2>
                <div className="group-share-row">
                  <input aria-label="Share link" readOnly value={window.location.href} />
                  <button type="button" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}>{copied ? 'Copied' : 'Copy link'}</button>
                </div>
                <p className="group-hint">Anyone with this link can view names and locations. Prefer MRT stations or approximate locations over home addresses.</p>

                {!currentMember ? (
                  <div className="group-owner-tools">
                    <div className="group-member-summary"><strong>Viewing without login</strong><span>Sign in only if you want to add or update your route.</span></div>
                    <form className="group-add-member" onSubmit={(event) => void submitLogin(event).catch(() => undefined)}>
                      <h3>Edit my route</h3>
                      <Field label="Username"><input autoComplete="username" required maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
                      <Field label="Password"><input type="password" autoComplete="current-password" minLength={6} required value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} /></Field>
                      <small className="group-hint">Already joined? Sign in. New here? Joining as a new person creates one route using this username.</small>
                      <button type="submit" disabled={props.busy}>{props.busy ? 'Checking…' : 'Sign in'}</button>
                      <button type="button" disabled={props.busy || !props.plan.joiningEnabled || !username.trim() || accessPassword.length < 6} onClick={() => void submitJoin().catch(() => undefined)}>{props.plan.joiningEnabled ? 'Join as a new person' : 'New joining is closed'}</button>
                    </form>
                    <details className="group-owner-login">
                      <summary>Plan owner sign in</summary>
                      <form className="group-add-member" onSubmit={(event) => void submitOwnerLogin(event).catch(() => undefined)}>
                        <Field label="Owner email"><input type="email" autoComplete="email" required value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></Field>
                        <Field label="Password"><input type="password" autoComplete="current-password" minLength={6} required value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /></Field>
                        <button type="submit" disabled={props.busy}>Owner sign in</button>
                      </form>
                    </details>
                  </div>
                ) : owner ? (
                  <div className="group-owner-tools">
                    <form className="group-inline-form" onSubmit={(event) => { event.preventDefault(); void props.onRename(title || props.plan!.title); }}>
                      <Field label="Plan name"><input maxLength={100} defaultValue={props.plan.title} onChange={(event) => setTitle(event.target.value)} /></Field>
                      <button type="submit" disabled={props.busy}>Rename</button>
                    </form>
                    <label className="group-joining-toggle">
                      <input type="checkbox" checked={props.plan.joiningEnabled} onChange={(event) => void props.onSetJoining(event.target.checked)} />
                      <span><strong>Allow new people to join</strong><small>Turn this off once your group is complete.</small></span>
                    </label>
                    <h3>People with edit access</h3>
                    {props.plan.members.some((member) => member.role !== 'owner' && !member.participantId) ? (
                      <p className="group-hint">Legacy email access is read-only. Remove that access, then create a username login for the person below.</p>
                    ) : null}
                    <ul className="group-member-list">
                      {props.plan.members.map((member) => (
                        <li key={member.id}>
                          <span><strong>{member.username || member.displayName}</strong><small>{member.role === 'owner' ? member.email : member.participantId ? 'One assigned route' : 'Legacy access · remove, then recreate below'} · {member.role}</small></span>
                          {member.role !== 'owner' ? (
                            <span className="group-member-actions">
                              <button type="button" onClick={() => { const temporaryPassword = window.prompt(`New password for ${member.username || member.displayName} (6+ characters)`); if (temporaryPassword) void props.onResetMember(member.id, temporaryPassword); }}>Reset password</button>
                              <button className="is-danger" type="button" onClick={() => { if (window.confirm(`Remove ${member.username || member.displayName}'s edit access? Their route will remain.`)) void props.onRemoveMember(member); }}>Remove access</button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <form className="group-add-member" onSubmit={(event) => void addMember(event).catch(() => undefined)}>
                      <h3>Create a login for an existing person</h3>
                      <Field label="Person">
                        <select required value={participantId} onChange={(event) => setParticipantId(event.target.value)}>
                          <option value="">Choose a named person</option>
                          {availableParticipants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Temporary password"><input type="password" minLength={6} required value={memberPassword} onChange={(event) => setMemberPassword(event.target.value)} /></Field>
                      <button type="submit" disabled={props.busy || availableParticipants.length === 0}>Create login</button>
                    </form>
                  </div>
                ) : (
                  <div className="group-member-summary"><strong>Signed in as {currentMember.username || currentMember.displayName}</strong><span>You can edit only your assigned route.</span></div>
                )}

                {currentMember ? (
                  <form className="group-password-form" onSubmit={(event) => { event.preventDefault(); void props.onChangePassword(newPassword).then(() => setNewPassword('')); }}>
                    <Field label="Change my password"><input type="password" minLength={6} required placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
                    <button type="submit" disabled={props.busy}>Update</button>
                  </form>
                ) : null}
                {props.error ? <p className="group-error" role="alert"><button type="button" onClick={props.onDismissError}>×</button>{props.error}</p> : null}
                {currentMember ? (
                  <div className="group-dialog-footer">
                    <button type="button" onClick={() => void props.onLogout()}>Sign out</button>
                    {owner ? <button className="is-danger" type="button" onClick={() => { if (window.confirm('Permanently delete this shared plan for everyone?')) void props.onDelete(); }}>Delete plan</button> : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
