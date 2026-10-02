import { useState, useEffect } from 'react';
import {
  useListProviders, useTestProvider, useGetModelConfig, useUpdateModelConfig,
  useListDependencies,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, ShieldCheck, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiGet, apiPost } from '@/lib/api';
import AutomationTab from './AutomationTab';
import { PageHeader, PageShell } from '@/components/layout/Page';

/** True when an error came back as an admin-gate 403 */
function isAdminRequired(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('403') || /admin access required/i.test(msg);
}

function AdminAccessCard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ isAdmin?: boolean }>('/auth/me')
      .then(me => setIsAdmin(me?.isAdmin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/admin-unlock', { password });
      setIsAdmin(true);
      setPassword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg.includes('403') ? 'Invalid admin password' : 'Unlock failed — try again');
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    setBusy(true);
    try {
      await apiPost('/auth/admin-lock');
      setIsAdmin(false);
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }

  if (isAdmin === null) return null;

  return (
    <div className="rounded-2xl border border-amber-400/20 bg-card px-5 py-4">
      {isAdmin ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <ShieldCheck className="w-4 h-4" />
            <span>Admin access active — you can change global provider and model settings.</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLock} disabled={busy}>Lock</Button>
        </div>
      ) : (
        <form onSubmit={handleUnlock} className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <span>Global settings changes require admin access.</span>
          </div>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Admin password"
            aria-label="Admin password"
            autoComplete="current-password"
            className="h-9 w-48 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock admin access'}
          </Button>
          {error && <span className="text-xs text-red-300">{error}</span>}
        </form>
      )}
    </div>
  );
}

const TABS = ['AI Providers', 'Model Configuration', 'Dependencies', 'Automation'] as const;
type Tab = typeof TABS[number];

const PROVIDER_ENV_KEYS: Record<string, { key: string; docs: string }> = {
  openai: { key: 'OPENAI_API_KEY', docs: 'https://platform.openai.com/api-keys' },
  anthropic: { key: 'ANTHROPIC_API_KEY', docs: 'https://console.anthropic.com/' },
  gemini: { key: 'GEMINI_API_KEY', docs: 'https://ai.google.dev/' },
};

const PIPELINE_STAGES = [
  { key: 'planningModel', label: 'Planning', description: 'Project scoping and strategy' },
  { key: 'researchModel', label: 'Research', description: 'Research plan generation and source analysis' },
  { key: 'outlineModel', label: 'Outline', description: 'Content structure generation' },
  { key: 'writingModel', label: 'Writing', description: 'Section drafting' },
  { key: 'editingModel', label: 'Editing', description: 'Tone, continuity, and proofreading edits' },
  { key: 'verificationModel', label: 'Verification', description: 'Claim fact-checking' },
  { key: 'evaluationModel', label: 'Evaluation', description: 'Quality scoring and readiness assessment' },
  { key: 'utilityModel', label: 'Utility', description: 'Classification, summarization, fallback' },
];

function ProvidersTab() {
  const { data: providers, refetch } = useListProviders();
  const testProvider = useTestProvider();
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testing, setTesting] = useState<string | null>(null);

  async function handleTest(name: string) {
    setTesting(name);
    try {
      const result = await testProvider.mutateAsync({ name });
      setTestResults(r => ({ ...r, [name]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [name]: { success: false, message: isAdminRequired(e) ? 'Admin access required to test connections — unlock admin access above.' : 'Connection failed', latencyMs: 0 } }));
    }
    setTesting(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Provider keys are server environment variables managed by the operator in the hosting platform's secret store
        (on Render: service → Environment). They are never entered or stored in the browser. Without a key, generation runs in
        clearly labelled demo mode.
      </p>

      {!providers?.length && (
        <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
          No providers configured.
        </div>
      )}

      {providers?.map(provider => {
        const meta = PROVIDER_ENV_KEYS[provider.name] ?? {};
        const testResult = testResults[provider.name];

        return (
          <div key={provider.name} className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-foreground">{provider.displayName}</p>
                  {provider.isConfigured ? (
                    <Badge variant="outline" className="text-emerald-300 border-emerald-400/25 text-xs">Configured</Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-300 border-amber-400/25 text-xs">Missing key</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{provider.description}</p>
                {meta.key && (
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded font-mono">{meta.key}</code>
                    {meta.docs && (
                      <a href={meta.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                        Get API key →
                      </a>
                    )}
                  </div>
                )}
                {provider.isConfigured && provider.availableModels && (
                  <p className="text-xs text-muted-foreground mt-2">Models: {provider.availableModels.slice(0, 4).join(', ')}{provider.availableModels.length > 4 ? '…' : ''}</p>
                )}
              </div>
              {provider.isConfigured && (
                <Button size="sm" variant="outline" onClick={() => handleTest(provider.name)} disabled={testing === provider.name}>
                  {testing === provider.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test Connection'}
                </Button>
              )}
            </div>

            {testResult && (
              <div className={`mt-3 flex items-start gap-2 p-3 rounded text-xs ${testResult.success ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span>{testResult.message}{testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ''}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Demo mode notice */}
      <div className="bg-muted/50 border border-border rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-1">Demo Mode</p>
        <p className="text-xs text-muted-foreground">
          When no provider is configured, Content OS runs in demo mode — clearly labeled placeholder output is returned for all AI operations.
          No content is sent to any external service. Add an API key to enable real generation.
        </p>
      </div>
    </div>
  );
}

function ModelConfigTab() {
  const qc = useQueryClient();
  const { data: config, isLoading } = useGetModelConfig();
  const update = useUpdateModelConfig();
  const { data: providers } = useListProviders();
  const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const allModels = providers?.flatMap(p => (p.availableModels ?? []).map(m => ({ provider: p.name, model: m }))) ?? [];

  function startEdit() {
    setForm({
      planningModel: (config as any)?.planningModel ?? '',
      researchModel: (config as any)?.researchModel ?? '',
      outlineModel: (config as any)?.outlineModel ?? '',
      writingModel: (config as any)?.writingModel ?? '',
      editingModel: (config as any)?.editingModel ?? '',
      verificationModel: (config as any)?.verificationModel ?? '',
      evaluationModel: (config as any)?.evaluationModel ?? '',
      utilityModel: (config as any)?.utilityModel ?? '',
    });
    setEditing(true);
  }

  async function handleSave() {
    setSaveError(null);
    try {
      await update.mutateAsync(form as any);
      qc.invalidateQueries({ queryKey: ['model-config'] });
      setEditing(false);
    } catch (e) {
      setSaveError(isAdminRequired(e)
        ? 'Admin access required to change model configuration — unlock admin access above.'
        : 'Failed to save configuration. Try again.');
    }
  }

  if (isLoading) return <div className="h-32 bg-muted animate-pulse rounded-lg" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-foreground">Pipeline Model Assignment</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Assign specific models to each pipeline stage. Leave blank to use the best available provider automatically.</p>
        </div>
        {!editing && <Button variant="outline" onClick={startEdit}>Edit Config</Button>}
      </div>

      <div className="bg-card border border-border rounded-2xl divide-y divide-border">
        {PIPELINE_STAGES.map(stage => {
          const val = editing ? (form[stage.key] ?? '') : ((config as any)?.[stage.key] ?? '');
          return (
            <div key={stage.key} className="px-5 py-3.5 flex items-center gap-4">
              <div className="w-32 flex-shrink-0">
                <p className="text-sm font-medium text-foreground/85">{stage.label}</p>
                <p className="text-xs text-muted-foreground leading-snug">{stage.description}</p>
              </div>
              {editing ? (
                <select aria-label={`${stage.label} model`}
                  value={val}
                  onChange={e => setForm(f => ({ ...f, [stage.key]: e.target.value }))}
                  className="flex-1 border border-border rounded px-3 py-1.5 text-sm"
                >
                  <option value="">Auto (best available)</option>
                  {allModels.map(m => (
                    <option key={`${m.provider}/${m.model}`} value={m.model}>{m.provider} / {m.model}</option>
                  ))}
                </select>
              ) : (
                <span className="flex-1 text-sm text-muted-foreground font-mono">{val || <span className="text-muted-foreground font-sans not-italic">Auto</span>}</span>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="flex gap-2 items-center flex-wrap">
          <Button onClick={handleSave} disabled={update.isPending} className="bg-primary hover:bg-primary/90 text-white">{update.isPending ? 'Saving…' : 'Save Config'}</Button>
          <Button variant="outline" onClick={() => { setEditing(false); setSaveError(null); }}>Cancel</Button>
          {saveError && <span className="text-xs text-red-300">{saveError}</span>}
        </div>
      )}
    </div>
  );
}

function DependenciesTab() {
  const { data: dependencies } = useListDependencies();
  const [filter, setFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categories = ['all', ...Array.from(new Set(dependencies?.map(d => d.category ?? '') ?? []))].filter(Boolean);

  const filtered = dependencies?.filter(d => filter === 'all' || d.category === filter) ?? [];

  const statusColors: Record<string, string> = {
    installed: 'bg-emerald-400/10 text-emerald-300',
    not_installed: 'bg-muted text-muted-foreground',
    optional: 'bg-sky-400/10 text-sky-300',
    deprecated: 'bg-red-500/10 text-red-300',
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground mb-1">Dependency Registry</h3>
        <p className="text-xs text-muted-foreground">All planned and optional dependencies for the content pipeline. Each entry tracks its install status, purpose, and decision rationale.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${filter === cat ? 'bg-primary text-white border-brand' : 'border-border text-muted-foreground hover:border-foreground/25'}`}
          >
            {cat === 'all' ? 'All' : cat}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {!filtered.length && (
          <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
            No dependency results found.
          </div>
        )}
        {filtered.map(dep => (
          <div key={dep.id} className="bg-card border border-border rounded-2xl overflow-hidden">
            <button
              onClick={() => setExpandedId(expandedId === dep.id ? null : dep.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/60 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground/85">{dep.componentName}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColors[dep.installStatus ?? ''] ?? 'bg-muted text-muted-foreground'}`}>{dep.installStatus}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{dep.purpose}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground">{dep.category}</span>
                {expandedId === dep.id ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </button>
            {expandedId === dep.id && (
              <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
                {dep.repositorySlug && <p className="text-xs text-muted-foreground">Repository: <a href={`https://github.com/${dep.repositorySlug}`} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{dep.repositorySlug}</a></p>}
                {dep.decisionReason && <p className="text-xs text-muted-foreground">{dep.decisionReason}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('AI Providers');

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Provider status, model assignments, system dependencies and automation access for this workspace."
      />

      <section aria-labelledby="security-heading" className="mb-8">
        <h2 id="security-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Security
        </h2>
        <AdminAccessCard />
      </section>

      <div className="mb-6 overflow-x-auto rounded-2xl border border-border bg-card p-1.5">
        <div role="tablist" aria-label="Settings sections" className="flex min-w-max gap-1">
          {TABS.map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-medium transition ${
                activeTab === tab
                  ? 'bg-secondary text-foreground shadow-[inset_0_-2px_0_0_hsl(var(--brand))]'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'AI Providers' && <ProvidersTab />}
      {activeTab === 'Model Configuration' && <ModelConfigTab />}
      {activeTab === 'Dependencies' && <DependenciesTab />}
      {activeTab === 'Automation' && <AutomationTab />}
    </PageShell>
  );
}
