import { useState, type FormEvent } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import { Panel, PanelHeader, LoadingState, StateMessage } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Notice, selectClass } from '@/components/grants/GrantUi';
import { errorMessage } from '@/lib/grants';
import { accountApi, inviteLink, useClientWorkspaces, useInvalidateAccount, useMe, useTeam, type RoleInfo } from '@/lib/account';

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 p-3">
      <p className="text-xs text-emerald-200">Send this link to the person. It works once and expires in 7 days. It is shown only now.</p>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`link-${link.slice(-8)}`}>Invitation link</label>
        <Input id={`link-${link.slice(-8)}`} readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="secondary" className="shrink-0 gap-1.5" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function roleLabel(roles: RoleInfo[], key: string): string {
  return roles.find((r) => r.key === key)?.label ?? key;
}

function InviteForm({ roles, canInviteOwner }: { roles: RoleInfo[]; canInviteOwner: boolean }) {
  const invalidate = useInvalidateAccount();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('writer');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLink('');
    setBusy(true);
    try {
      const result = await accountApi.invite(email, role);
      setLink(inviteLink(result.invitePath));
      setEmail('');
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const description = roles.find((r) => r.key === role)?.description;
  return (
    <form onSubmit={submit} className="space-y-3 px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
        <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
            {roles.filter((r) => canInviteOwner || r.key !== 'owner').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </Field>
        <Button type="submit" disabled={busy || !email}>{busy ? 'Creating…' : 'Create invitation'}</Button>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      {link && <CopyLink link={link} />}
    </form>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      await accountApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setMessage({ tone: 'ok', text: 'Password changed.' });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password" hint="At least 12 characters."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Button type="submit" disabled={!current || !next}>Change password</Button>
      {message && <div className="sm:col-span-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
    </form>
  );
}

function ClientWorkspaces() {
  const list = useClientWorkspaces(true);
  const invalidate = useInvalidateAccount();
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLink('');
    try {
      const result = await accountApi.createWorkspace(name, ownerEmail);
      setLink(inviteLink(result.invitePath));
      setName('');
      setOwnerEmail('');
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Panel>
      <PanelHeader title="Client workspaces" description="Each client organization gets its own workspace, with data no other workspace can see. Its first owner receives an invitation link." />
      <form onSubmit={submit} className="space-y-3 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Workspace name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="First owner's email"><Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} /></Field>
          <Button type="submit" disabled={!name.trim() || !ownerEmail}>Create workspace</Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {link && <CopyLink link={link} />}
      </form>
      {list.data && list.data.length > 0 && (
        <ul className="divide-y divide-border border-t border-border">
          {list.data.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="font-medium text-foreground">{w.name}</span>
              <span className="text-xs text-muted-foreground">{w.kind === 'agency' ? 'Agency' : 'Client'} · {w.members} member{w.members === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function TeamTab() {
  const me = useMe();
  const team = useTeam();
  const invalidate = useInvalidateAccount();
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);

  if (team.isLoading || me.isLoading) return <LoadingState label="Loading your team…" className="min-h-[20vh]" />;
  if (team.isError || !team.data || !me.data) return <StateMessage tone="error" title="The team could not load" description={errorMessage(team.error)} action={<Button onClick={() => team.refetch()}>Try again</Button>} />;
  const t = team.data;
  const self = me.data;

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await invalidate();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function switchTo(id: string) {
    setSwitching(true);
    try {
      await accountApi.switchWorkspace(id);
      window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/grant-studio`);
    } catch (err) {
      setError(errorMessage(err));
      setSwitching(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title={t.workspace.name} description={`You are ${self.member ? `signed in as ${self.member.name} (${self.member.email})` : 'signed in with the team password'} · ${self.roleLabel ?? self.role ?? 'member'}`} />
        {self.workspaces.length > 1 && (
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Field label="Switch workspace">
              <select defaultValue={self.workspace?.id} onChange={(e) => switchTo(e.target.value)} disabled={switching} className={selectClass}>
                {self.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        {!self.member && (
          <div className="px-5 pb-4">
            <Notice tone="info" title="Use personal accounts">The team password signs everyone in as the same operator. Invite each person with their own email so approvals record who made them, and access can be removed person by person.</Notice>
          </div>
        )}
      </Panel>

      {error && <Notice tone="error">{error}</Notice>}

      <Panel>
        <PanelHeader title="Members" description={`${t.members.length} member${t.members.length === 1 ? '' : 's'}.`} />
        {t.members.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No personal accounts yet. Invite your team below.</p>
        ) : (
          <ul className="divide-y divide-border">
            {t.members.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.name}{m.isYou ? ' (you)' : ''}</p>
                  <p className="text-xs text-muted-foreground">{m.email}{m.lastSignInAt ? ` · last signed in ${new Date(m.lastSignInAt).toLocaleDateString()}` : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  {t.canManage && !m.isYou ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
                      <select id={`role-${m.id}`} value={m.role} onChange={(e) => act(() => accountApi.setRole(m.id, e.target.value))} className={selectClass}>
                        {t.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                      </select>
                      <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove ${m.name}`} onClick={() => { if (window.confirm(`Remove ${m.name} from ${t.workspace.name}? Their access ends immediately.`)) void act(() => accountApi.removeMember(m.id)); }}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{roleLabel(t.roles, m.role)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {t.canManage && (
        <Panel>
          <PanelHeader title="Invite someone" description="They choose their own password. Roles can be changed at any time." />
          <InviteForm roles={t.roles} canInviteOwner={self.role === 'owner'} />
          {t.invites.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {t.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">{i.email} <span className="text-xs text-muted-foreground">· {roleLabel(t.roles, i.role)} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => act(() => accountApi.revokeInvite(i.id))} aria-label={`Withdraw the invitation for ${i.email}`}>Withdraw</Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {self.member && (
        <Panel>
          <PanelHeader title="Your account" />
          <PasswordForm />
        </Panel>
      )}

      {self.isAdmin && <ClientWorkspaces />}
    </div>
  );
}
