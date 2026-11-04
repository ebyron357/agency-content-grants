import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

/** The signed-in person, workspace and role (GET /api/auth/me). */
export interface Me {
  authenticated: boolean;
  isAdmin: boolean;
  member: { id: string; email: string; name: string; mfaEnabled?: boolean } | null;
  workspace: { id: string; name: string; kind: string } | null;
  role: string | null;
  roleLabel: string | null;
  /** What the role may do (api-server lib/permissions.ts). */
  permissions?: string[];
  workspaces: { id: string; name: string; role: string }[];
  /** Two-factor state for the signed-in workspace. */
  mfa?: { required: boolean; enrollmentRequired: boolean };
  /** Signed out, with a password accepted and a code still to enter. */
  mfaPending?: boolean;
}

export interface RoleInfo {
  key: string;
  label: string;
  description: string;
  permissions?: string[];
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  status: string;
  role: string;
  since: string;
  lastSignInAt: string | null;
  mfaEnabled?: boolean;
  isYou: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  expiresAt: string;
}

export interface Team {
  workspace: { id: string; name: string; kind: string; requireMfa?: boolean };
  role: string | null;
  canManage: boolean;
  roles: RoleInfo[];
  permissions?: { key: string; description: string }[];
  members: TeamMember[];
  invites: PendingInvite[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** An absolute link for an invitation path returned by the API. */
export function inviteLink(invitePath: string): string {
  return `${window.location.origin}${BASE}${invitePath}`;
}

export const useMe = () => useQuery({ queryKey: ['account', 'me'], queryFn: () => apiGet<Me>('/auth/me') });
/**
 * What the signed-in role may do. Screens hide or explain actions the server
 * would refuse; the server enforces the same rules either way.
 */
export function usePermissions() {
  const me = useMe();
  const held = me.data?.permissions;
  return {
    /** True when the role holds any of the permissions. Before /auth/me answers, nothing is offered. */
    can: (...anyOf: string[]) => (me.data ? !held || anyOf.some((p) => held.includes(p)) : false),
    roleLabel: me.data?.roleLabel ?? null,
  };
}

export const useTeam = () => useQuery({ queryKey: ['account', 'team'], queryFn: () => apiGet<Team>('/workspace') });
export const useClientWorkspaces = (enabled: boolean) =>
  useQuery({ queryKey: ['account', 'workspaces'], queryFn: () => apiGet<{ id: string; name: string; kind: string; members: number }[]>('/workspaces'), enabled });

export interface Security {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  requiredByWorkspace: boolean;
  secretsEncrypted: boolean;
}

export interface SignedInSession {
  id: string;
  device: string;
  ipAddress: string | null;
  workspace: string | null;
  method: string;
  signedInAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AuditEntry {
  id: string;
  type: string;
  description: string;
  actor: string | null;
  at: string;
}

export interface AuditPage {
  categories: { key: string; label: string }[];
  entries: AuditEntry[];
  nextBefore: string | null;
}

export const useSecurity = (enabled = true) => useQuery({ queryKey: ['account', 'security'], queryFn: () => apiGet<Security>('/account/security'), enabled });
export const useSessions = (enabled = true) => useQuery({ queryKey: ['account', 'sessions'], queryFn: () => apiGet<SignedInSession[]>('/account/sessions'), enabled });

/** Query string for the audit log filters, shared by the screen and the CSV link. */
export function auditQuery(filters: { category?: string; q?: string; before?: string | null }): string {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.before) params.set('before', filters.before);
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const auditCsvUrl = (filters: { category?: string; q?: string }) => `${BASE}/api/workspace/audit.csv${auditQuery(filters)}`;

export function useInvalidateAccount() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['account'] });
}

export const accountApi = {
  invite: (email: string, role: string) => apiPost('/workspace/invites', { email, role }) as Promise<{ id: string; email: string; role: string; expiresAt: string; invitePath: string }>,
  revokeInvite: (id: string) => apiDelete(`/workspace/invites/${id}`),
  setRole: (memberId: string, role: string) => apiPatch(`/workspace/members/${memberId}`, { role }),
  removeMember: (memberId: string) => apiDelete(`/workspace/members/${memberId}`),
  renameWorkspace: (name: string) => apiPatch('/workspace', { name }),
  createWorkspace: (name: string, ownerEmail: string) => apiPost('/workspaces', { name, ownerEmail }) as Promise<{ workspace: { id: string; name: string }; ownerEmail: string; invitePath: string; expiresAt: string }>,
  changePassword: (currentPassword: string, newPassword: string) => apiPost('/auth/password', { currentPassword, newPassword }),
  switchWorkspace: (workspaceId: string) => apiPost('/auth/switch-workspace', { workspaceId }),
  setRequireMfa: (requireMfa: boolean) => apiPatch('/workspace', { requireMfa }),
  mfaSetup: () => apiPost('/account/mfa/setup') as Promise<{ secret: string; otpauthUri: string }>,
  mfaEnable: (code: string) => apiPost('/account/mfa/enable', { code }) as Promise<{ mfaEnabled: true; recoveryCodes: string[] }>,
  mfaDisable: (password: string, code: string) => apiPost('/account/mfa/disable', { password, code }),
  newRecoveryCodes: (code: string) => apiPost('/account/mfa/recovery-codes', { code }) as Promise<{ recoveryCodes: string[] }>,
  endSession: (id: string) => apiDelete(`/account/sessions/${id}`),
  endOtherSessions: () => apiPost('/account/sessions/revoke-others') as Promise<{ ended: number }>,
  audit: (filters: { category?: string; q?: string; before?: string | null }) => apiGet<AuditPage>(`/workspace/audit${auditQuery(filters)}`),
};
