import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Key, Loader2, Plus, RotateCw, Trash2, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

/**
 * API Keys + Webhook Subscriptions management for external automation
 * (n8n, etc). See docs/automation-api.md for the full HTTP contract this
 * dashboard configures.
 */

interface ApiKey {
  id: string; name: string; keyPrefix: string; scopes: string[];
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string;
}
interface WebhookSubscription {
  id: string; brandId: string | null; url: string; description: string | null;
  eventTypes: string[]; isActive: boolean; createdAt: string; secret?: string;
}
interface WebhookDelivery {
  id: string; eventType: string; status: string; attemptCount: number;
  lastAttemptAt: string | null; lastError: string | null; lastResponseStatus: number | null; createdAt: string;
}

const SCOPES = ['read', 'projects:write', 'repurposing:write', 'publishing:write'];

function CopyableSecret({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-2">
      <p className="text-xs font-semibold text-amber-800 mb-1">{label} — shown once, save it now</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 font-mono break-all">{value}</code>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <Copy className="w-3.5 h-3.5 mr-1" /> {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data: keys, isLoading } = useQuery<ApiKey[]>({ queryKey: ['automation', 'api-keys'], queryFn: () => apiGet('/api-keys') });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim() || scopes.length === 0) return;
    setBusy(true);
    try {
      const result = await apiPost('/api-keys', { name: name.trim(), scopes }) as ApiKey & { key: string };
      setNewKey(result.key);
      setName(''); setScopes(['read']); setCreating(false);
      qc.invalidateQueries({ queryKey: ['automation', 'api-keys'] });
    } finally { setBusy(false); }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Anything using it will stop working immediately.')) return;
    await apiDelete(`/api-keys/${id}`);
    qc.invalidateQueries({ queryKey: ['automation', 'api-keys'] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-stone-800 flex items-center gap-2"><Key className="w-4 h-4" /> API Keys</h3>
          <p className="text-xs text-stone-400 mt-0.5">Bearer tokens for external tools (e.g. n8n) to call <code className="font-mono">/api/automation/*</code> instead of a session cookie.</p>
        </div>
        {!creating && <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 mr-1" /> New key</Button>}
      </div>

      {newKey && <CopyableSecret label="New API key" value={newKey} />}

      {creating && (
        <div className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
          <Input placeholder="Key name (e.g. 'n8n production')" value={name} onChange={e => setName(e.target.value)} className="text-sm" />
          <div className="flex flex-wrap gap-2">
            {SCOPES.map(s => (
              <button
                key={s}
                onClick={() => setScopes(cur => cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])}
                className={`text-xs px-2.5 py-1 rounded-full border ${scopes.includes(s) ? 'bg-[#C8102E] text-white border-[#C8102E]' : 'border-stone-200 text-stone-500'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={busy || !name.trim() || scopes.length === 0} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading && <div className="h-16 bg-stone-100 animate-pulse rounded-lg" />}
      {keys?.length === 0 && <div className="bg-white border border-stone-200 rounded-lg p-6 text-center text-stone-400 text-sm">No API keys yet.</div>}
      {keys?.map(key => (
        <div key={key.id} className="bg-white border border-stone-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-stone-700">{key.name}</p>
              {key.revokedAt ? <Badge variant="outline" className="text-red-500 border-red-200 text-xs">Revoked</Badge> : <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Active</Badge>}
            </div>
            <p className="text-xs text-stone-400 font-mono mt-0.5">{key.keyPrefix}…</p>
            <p className="text-xs text-stone-400 mt-0.5">Scopes: {(key.scopes ?? []).join(', ')}{key.lastUsedAt ? ` · last used ${new Date(key.lastUsedAt).toLocaleString()}` : ' · never used'}</p>
          </div>
          {!key.revokedAt && (
            <Button size="sm" variant="outline" onClick={() => handleRevoke(key.id)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Revoke</Button>
          )}
        </div>
      ))}
    </div>
  );
}

function DeliveriesList({ subscriptionId }: { subscriptionId: string }) {
  const qc = useQueryClient();
  const { data: deliveries, isLoading } = useQuery<WebhookDelivery[]>({
    queryKey: ['automation', 'deliveries', subscriptionId],
    queryFn: () => apiGet(`/webhooks/subscriptions/${subscriptionId}/deliveries`),
  });

  async function handleRedeliver(id: string) {
    await apiPost(`/webhooks/deliveries/${id}/redeliver`);
    qc.invalidateQueries({ queryKey: ['automation', 'deliveries', subscriptionId] });
  }

  const statusColor: Record<string, string> = {
    delivered: 'bg-green-50 text-green-700', pending: 'bg-amber-50 text-amber-700',
    delivering: 'bg-blue-50 text-blue-700', failed: 'bg-red-50 text-red-600',
  };

  if (isLoading) return <div className="h-10 bg-stone-50 animate-pulse rounded" />;
  if (!deliveries?.length) return <p className="text-xs text-stone-400 px-1 py-2">No deliveries yet — they appear here once a matching event fires.</p>;

  return (
    <div className="divide-y divide-stone-100">
      {deliveries.map(d => (
        <div key={d.id} className="py-2 px-1 flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <span className="font-mono text-stone-600">{d.eventType}</span>
            <span className={`ml-2 px-1.5 py-0.5 rounded font-medium ${statusColor[d.status] ?? 'bg-stone-100 text-stone-500'}`}>{d.status}</span>
            <span className="ml-2 text-stone-400">attempt {d.attemptCount}{d.lastResponseStatus ? ` · HTTP ${d.lastResponseStatus}` : ''}</span>
            {d.lastError && <p className="text-red-500 mt-0.5 truncate">{d.lastError}</p>}
          </div>
          {d.status === 'failed' && (
            <Button size="sm" variant="outline" onClick={() => handleRedeliver(d.id)}><RotateCw className="w-3 h-3 mr-1" /> Redeliver</Button>
          )}
        </div>
      ))}
    </div>
  );
}

function WebhooksSection() {
  const qc = useQueryClient();
  const { data: eventTypesResp } = useQuery<{ eventTypes: string[] }>({ queryKey: ['automation', 'event-types'], queryFn: () => apiGet('/webhooks/event-types') });
  const { data: subs, isLoading } = useQuery<WebhookSubscription[]>({ queryKey: ['automation', 'subscriptions'], queryFn: () => apiGet('/webhooks/subscriptions') });
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const eventTypes = eventTypesResp?.eventTypes ?? [];

  async function handleCreate() {
    if (!url.trim() || selectedTypes.length === 0) return;
    setBusy(true);
    try {
      const result = await apiPost('/webhooks/subscriptions', { url: url.trim(), eventTypes: selectedTypes }) as WebhookSubscription;
      setNewSecret(result.secret ?? null);
      setUrl(''); setSelectedTypes([]); setCreating(false);
      qc.invalidateQueries({ queryKey: ['automation', 'subscriptions'] });
    } finally { setBusy(false); }
  }

  async function handleToggleActive(sub: WebhookSubscription) {
    await apiPatch(`/webhooks/subscriptions/${sub.id}`, { isActive: !sub.isActive });
    qc.invalidateQueries({ queryKey: ['automation', 'subscriptions'] });
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this webhook subscription? Pending deliveries will be cancelled.')) return;
    await apiDelete(`/webhooks/subscriptions/${id}`);
    qc.invalidateQueries({ queryKey: ['automation', 'subscriptions'] });
  }

  async function handleRotateSecret(id: string) {
    const result = await apiPost(`/webhooks/subscriptions/${id}/rotate-secret`) as WebhookSubscription;
    setNewSecret(result.secret ?? null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-stone-800 flex items-center gap-2"><Webhook className="w-4 h-4" /> Webhook Subscriptions</h3>
          <p className="text-xs text-stone-400 mt-0.5">HMAC-signed (Standard Webhooks) deliveries for lifecycle events. See <code className="font-mono">docs/automation-api.md</code> for verification code.</p>
        </div>
        {!creating && <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 mr-1" /> New subscription</Button>}
      </div>

      {newSecret && <CopyableSecret label="Signing secret" value={newSecret} />}

      {creating && (
        <div className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
          <Input placeholder="https://your-n8n-instance.example.com/webhook/..." value={url} onChange={e => setUrl(e.target.value)} className="text-sm" />
          <div className="flex flex-wrap gap-2">
            {eventTypes.map(t => (
              <button
                key={t}
                onClick={() => setSelectedTypes(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t])}
                className={`text-xs px-2.5 py-1 rounded-full border font-mono ${selectedTypes.includes(t) ? 'bg-[#C8102E] text-white border-[#C8102E]' : 'border-stone-200 text-stone-500'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleCreate} disabled={busy || !url.trim() || selectedTypes.length === 0} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading && <div className="h-16 bg-stone-100 animate-pulse rounded-lg" />}
      {subs?.length === 0 && <div className="bg-white border border-stone-200 rounded-lg p-6 text-center text-stone-400 text-sm">No webhook subscriptions yet.</div>}
      {subs?.map(sub => (
        <div key={sub.id} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-stone-700 truncate">{sub.url}</p>
                <Badge variant="outline" className={`text-xs ${sub.isActive ? 'text-green-600 border-green-200' : 'text-stone-400 border-stone-200'}`}>{sub.isActive ? 'Active' : 'Paused'}</Badge>
              </div>
              <p className="text-xs text-stone-400 font-mono mt-0.5">{(sub.eventTypes ?? []).join(', ')}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" variant="outline" onClick={() => setExpanded(expanded === sub.id ? null : sub.id)}>Deliveries</Button>
              <Button size="sm" variant="outline" onClick={() => handleRotateSecret(sub.id)}><RotateCw className="w-3.5 h-3.5" /></Button>
              <Button size="sm" variant="outline" onClick={() => handleToggleActive(sub)}>{sub.isActive ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" variant="outline" onClick={() => handleDelete(sub.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
          {expanded === sub.id && (
            <div className="border-t border-stone-100 px-4 pb-2">
              <DeliveriesList subscriptionId={sub.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AutomationTab() {
  return (
    <div className="space-y-8">
      <ApiKeysSection />
      <div className="border-t border-stone-100 pt-6">
        <WebhooksSection />
      </div>
    </div>
  );
}
