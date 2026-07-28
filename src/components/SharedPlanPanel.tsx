import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  requestedPlanId: string | null;
  claimToken: string | null;
  busy: boolean;
  syncLabel: string;
  error: string;
  onCreate: (input: CreatePlanInput) => Promise<void>;
  onLogin: (username: string, password: string) => Promise<void>;
  onJoin: (username: string, password: string) => Promise<void>;
  onClaim: (username: string, password: string) => Promise<void>;
  onOwnerLogin: (email: string, password: string) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onSetJoining: (enabled: boolean) => Promise<void>;
  onCreateInvite: (participantId: string) => Promise<string>;
  onResetMember: (memberId: string, temporaryPassword: string) => Promise<void>;
  onRemoveMember: (member: SharedMember) => Promise<void>;
  onChangePassword: (password: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onDelete: () => Promise<void>;
  onLeave: () => Promise<void>;
  onDismissError: () => void;
}

type AccessMode = 'claim' | 'join' | 'login';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary:first-of-type',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="group-field"><span>{label}</span>{children}</label>;
}

export function SharedPlanPanel(props: SharedPlanPanelProps) {
  const [dialog, setDialog] = useState<'create' | 'manage' | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>('join');
  const [title, setTitle] = useState('Weekend meetup');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [username, setUsername] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [accessPasswordConfirmation, setAccessPasswordConfirmation] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [copied, setCopied] = useState<'plan' | 'invite' | null>(null);
  const [localError, setLocalError] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const autoOpenedPlanRef = useRef<string | null>(null);
  const dialogOpen = dialog !== null;

  const currentMember = props.plan?.currentMember ?? null;
  const owner = currentMember?.role === 'owner';
  const availableParticipants = useMemo(() => {
    if (!props.plan || !owner) return [];
    const assigned = new Set(props.plan.members.map((member) => member.participantId).filter(Boolean));
    return props.plan.participants.filter((participant) => participant.name.trim() && !assigned.has(participant.id));
  }, [owner, props.plan]);
  const availableAccessModes = useMemo<AccessMode[]>(() => [
    ...(props.claimToken ? ['claim' as const] : []),
    ...(props.plan?.joiningEnabled ? ['join' as const] : []),
    'login',
  ], [props.claimToken, props.plan?.joiningEnabled]);

  const planUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    return url.toString();
  }, [props.plan?.id]);

  useEffect(() => {
    if (props.plan) setTitle(props.plan.title);
  }, [props.plan?.id, props.plan?.title]);

  useEffect(() => {
    if (!props.plan || currentMember || autoOpenedPlanRef.current === props.plan.id) return;
    autoOpenedPlanRef.current = props.plan.id;
    setAccessMode(props.claimToken ? 'claim' : props.plan.joiningEnabled ? 'join' : 'login');
    setDialog('manage');
  }, [currentMember, props.claimToken, props.plan]);

  useEffect(() => {
    if (!availableAccessModes.includes(accessMode)) setAccessMode(availableAccessModes[0]);
  }, [accessMode, availableAccessModes]);

  useEffect(() => {
    if (!dialogOpen) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDialog(null);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => {
          if (element.closest('[hidden], [aria-hidden="true"]')) return false;
          const closedDetails = element.closest('details:not([open])');
          return !closedDetails || element.matches('summary');
        });
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) dialogRef.current.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      document.body.style.overflow = previousBodyOverflow;
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus();
      else triggerRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [dialogOpen]);

  function closeDialog() {
    setLocalError('');
    props.onDismissError();
    setDialog(null);
  }

  function chooseAccessMode(nextMode: AccessMode) {
    setAccessMode(nextMode);
    setLocalError('');
    props.onDismissError();
  }

  function handleAccessTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(
      event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    if (tabs.length === 0) return;

    event.preventDefault();
    const currentIndex = tabs.indexOf(event.currentTarget);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    chooseAccessMode(nextTab.dataset.accessMode as AccessMode);
    nextTab.focus();
  }

  async function copyText(value: string, kind: 'plan' | 'invite') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setLocalError('Copying was blocked. Select the link and copy it manually.');
    }
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (password !== passwordConfirmation) {
      setLocalError('The owner passwords do not match.');
      return;
    }
    await props.onCreate({ title, displayName, email, password });
    setPassword('');
    setPasswordConfirmation('');
    setDialog('manage');
  }

  async function submitAccess(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (accessMode !== 'login' && accessPassword !== accessPasswordConfirmation) {
      setLocalError('The passwords do not match.');
      return;
    }
    if (accessMode === 'claim') await props.onClaim(username, accessPassword);
    else if (accessMode === 'join') await props.onJoin(username, accessPassword);
    else await props.onLogin(username, accessPassword);
    setAccessPassword('');
    setAccessPasswordConfirmation('');
    closeDialog();
  }

  async function submitOwnerLogin(event: FormEvent) {
    event.preventDefault();
    await props.onOwnerLogin(ownerEmail, ownerPassword);
    setOwnerPassword('');
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    if (!participantId) return;
    setInviteUrl(await props.onCreateInvite(participantId));
  }

  async function leaveLocalPlan() {
    await props.onLeave();
    closeDialog();
  }

  const buttonLabel = props.requestedPlanId && !props.plan
    ? props.busy ? 'Loading shared plan…' : 'Shared plan unavailable'
    : !props.plan
      ? 'Make this a shared plan'
    : owner
      ? 'Shared plan · Manage'
      : currentMember
        ? 'My shared route'
        : 'Join this plan';

  const combinedError = localError || props.error;
  const isAccessDialog = dialog === 'manage' && Boolean(props.plan) && !currentMember;
  const dialogRoot = document.getElementById('group-dialog-root');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={props.plan ? 'group-plan-button is-shared' : 'group-plan-button'}
        onClick={() => setDialog(props.requestedPlanId || props.plan ? 'manage' : 'create')}
      >
        <span className="group-plan-dot" />
        <span>{buttonLabel}</span>
        {props.plan ? <small>{currentMember ? props.syncLabel : 'View only'}</small> : null}
      </button>

      {dialog && dialogRoot ? createPortal(
        <div className={`group-dialog-backdrop${isAccessDialog ? ' is-access' : ''}`} role="presentation" onMouseDown={closeDialog}>
          <section ref={dialogRef} tabIndex={-1} className={`group-dialog${isAccessDialog ? ' group-dialog-access' : ''}`} role="dialog" aria-modal="true" aria-labelledby="group-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="group-dialog-close" type="button" aria-label="Close" onClick={closeDialog}>×</button>

            {dialog === 'create' ? (
              <>
                <p className="group-kicker">Share with your group</p>
                <h2 id="group-dialog-title">Create a shared plan</h2>
                <p className="group-dialog-copy">Friends can view the plan from its link and create access to add their own route. You stay in control.</p>
                <form onSubmit={(event) => void submitCreate(event).catch(() => undefined)}>
                  <Field label="Plan name"><input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                  <div className="group-field-row">
                    <Field label="Your name"><input autoComplete="name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
                    <Field label="Owner email"><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  </div>
                  <Field label="Owner password"><input type="password" autoComplete="new-password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                  <Field label="Confirm owner password"><input type="password" autoComplete="new-password" minLength={6} required value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} /></Field>
                  <small className="group-hint">Use at least 6 characters. There is no email password recovery yet, so save this password somewhere safe.</small>
                  {combinedError ? <p className="group-error" role="alert">{combinedError}</p> : null}
                  <button className="group-primary" type="submit" disabled={props.busy}>{props.busy ? 'Creating…' : 'Create shared plan'}</button>
                </form>
              </>
            ) : !props.plan ? (
              <>
                <p className="group-kicker">{currentMember ? 'Shared plan' : 'You’re invited'}</p>
                <h2 id="group-dialog-title">This plan could not be opened</h2>
                <p className="group-dialog-copy">{props.error || 'The link may be invalid or the plan may have been deleted.'}</p>
                <button className="group-primary group-standalone-action" type="button" onClick={() => void leaveLocalPlan().catch(() => undefined)}>Return to my local plan</button>
              </>
            ) : (
              <>
                <p className="group-kicker">Shared plan</p>
                <h2 id="group-dialog-title">{props.plan.title}</h2>
                {currentMember ? (
                  <>
                    <div className="group-share-row">
                      <input aria-label="Share link" readOnly value={planUrl} />
                      <button type="button" onClick={() => void copyText(planUrl, 'plan')}>{copied === 'plan' ? 'Copied' : 'Copy link'}</button>
                    </div>
                    <p className="group-hint">Anyone with this link can view names and locations. Prefer MRT stations or approximate locations over home addresses.</p>
                  </>
                ) : (
                  <p className="group-dialog-copy">Join to add your route, or sign in to update one you already created.</p>
                )}

                {!currentMember ? (
                  <div className="group-owner-tools group-access-tools">
                    <div className="group-access-tabs" role="tablist" aria-label="Plan access options">
                      {props.claimToken ? <button id="group-access-tab-claim" data-access-mode="claim" type="button" role="tab" aria-controls="group-access-panel" aria-selected={accessMode === 'claim'} tabIndex={accessMode === 'claim' ? 0 : -1} className={accessMode === 'claim' ? 'is-active' : ''} onKeyDown={handleAccessTabKeyDown} onClick={() => chooseAccessMode('claim')}>Claim my route</button> : null}
                      {props.plan.joiningEnabled ? <button id="group-access-tab-join" data-access-mode="join" type="button" role="tab" aria-controls="group-access-panel" aria-selected={accessMode === 'join'} tabIndex={accessMode === 'join' ? 0 : -1} className={accessMode === 'join' ? 'is-active' : ''} onKeyDown={handleAccessTabKeyDown} onClick={() => chooseAccessMode('join')}>I’m new here</button> : null}
                      <button id="group-access-tab-login" data-access-mode="login" type="button" role="tab" aria-controls="group-access-panel" aria-selected={accessMode === 'login'} tabIndex={accessMode === 'login' ? 0 : -1} className={accessMode === 'login' ? 'is-active' : ''} onKeyDown={handleAccessTabKeyDown} onClick={() => chooseAccessMode('login')}>Sign in</button>
                    </div>
                    <form id="group-access-panel" className="group-add-member group-access-form" role="tabpanel" aria-labelledby={`group-access-tab-${accessMode}`} onSubmit={(event) => void submitAccess(event).catch(() => undefined)}>
                      <h3>{accessMode === 'claim' ? 'Claim your listed route' : accessMode === 'join' ? 'Join as a new person' : 'Welcome back'}</h3>
                      <p>{accessMode === 'claim' ? 'This personal link connects your login to the route the organiser created for you.' : accessMode === 'join' ? 'We’ll add one new route under your name.' : 'Use the name and password you chose for this plan.'}</p>
                      <Field label="Name in this plan"><input autoComplete="username" required maxLength={80} value={username} onChange={(event) => setUsername(event.target.value)} /></Field>
                      <Field label="Password"><input type="password" autoComplete={accessMode === 'login' ? 'current-password' : 'new-password'} minLength={6} required value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} /></Field>
                      {accessMode !== 'login' ? <Field label="Confirm password"><input type="password" autoComplete="new-password" minLength={6} required value={accessPasswordConfirmation} onChange={(event) => setAccessPasswordConfirmation(event.target.value)} /></Field> : null}
                      {combinedError ? <p className="group-error" role="alert">{combinedError}</p> : null}
                      <button className="group-primary" type="submit" disabled={props.busy}>{props.busy ? 'Please wait…' : accessMode === 'claim' ? 'Claim route and continue' : accessMode === 'join' ? 'Join plan' : 'Sign in'}</button>
                    </form>
                    {!props.plan.joiningEnabled && !props.claimToken ? <p className="group-hint">The owner has closed new joining. Existing members can still sign in.</p> : null}
                    <details className="group-owner-login">
                      <summary>Are you the plan owner?</summary>
                      <form className="group-add-member" onSubmit={(event) => void submitOwnerLogin(event).catch(() => undefined)}>
                        <Field label="Owner email"><input type="email" autoComplete="email" required value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /></Field>
                        <Field label="Password"><input type="password" autoComplete="current-password" minLength={6} required value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /></Field>
                        <button className="group-primary" type="submit" disabled={props.busy}>Owner sign in</button>
                      </form>
                    </details>
                  </div>
                ) : owner ? (
                  <div className="group-owner-tools">
                    <form className="group-inline-form" onSubmit={(event) => { event.preventDefault(); void props.onRename(title); }}>
                      <Field label="Plan name"><input maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
                      <button type="submit" disabled={props.busy}>Rename</button>
                    </form>
                    <label className="group-joining-toggle">
                      <input type="checkbox" checked={props.plan.joiningEnabled} onChange={(event) => void props.onSetJoining(event.target.checked)} />
                      <span><strong>Allow new people to join</strong><small>Personal claim links still work when this is off.</small></span>
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
                    <form className="group-add-member" onSubmit={(event) => void createInvite(event).catch(() => undefined)}>
                      <h3>Invite someone already listed</h3>
                      <p>Send a private, one-time link so they can choose their own name and password. It expires after 7 days.</p>
                      <Field label="Person">
                        <select required value={participantId} onChange={(event) => { setParticipantId(event.target.value); setInviteUrl(''); }}>
                          <option value="">Choose a named person</option>
                          {availableParticipants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name}</option>)}
                        </select>
                      </Field>
                      <button type="submit" disabled={props.busy || availableParticipants.length === 0}>Create personal invite</button>
                      {inviteUrl ? (
                        <div className="group-invite-result">
                          <strong>Personal invite ready</strong>
                          <div className="group-share-row">
                            <input aria-label="Personal invite link" readOnly value={inviteUrl} />
                            <button type="button" onClick={() => void copyText(inviteUrl, 'invite')}>{copied === 'invite' ? 'Copied' : 'Copy'}</button>
                          </div>
                          <small>Share this only with the selected person. Creating another invite for them invalidates this one.</small>
                        </div>
                      ) : null}
                    </form>
                  </div>
                ) : (
                  <div className="group-member-summary"><strong>Signed in as {currentMember.username || currentMember.displayName}</strong><span>You can edit only your assigned route.</span></div>
                )}

                {currentMember ? (
                  <form className="group-password-form" onSubmit={(event) => { event.preventDefault(); void props.onChangePassword(newPassword).then(() => setNewPassword('')); }}>
                    <Field label="Change my password"><input type="password" autoComplete="new-password" minLength={6} required placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
                    <button type="submit" disabled={props.busy}>Update</button>
                  </form>
                ) : null}
                {currentMember && combinedError ? <p className="group-error" role="alert"><button type="button" onClick={() => { setLocalError(''); props.onDismissError(); }}>×</button>{combinedError}</p> : null}
                {currentMember ? (
                  <div className="group-dialog-footer">
                    <button type="button" onClick={() => void props.onLogout()}>Sign out</button>
                    {owner ? <button className="is-danger" type="button" onClick={() => { if (window.confirm('Permanently delete this shared plan for everyone?')) void props.onDelete(); }}>Delete plan</button> : null}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>,
        dialogRoot,
      ) : null}
    </>
  );
}
