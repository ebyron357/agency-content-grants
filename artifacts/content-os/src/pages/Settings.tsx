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
    <div className="mb-6 bg-white border border-stone-200 rounded-lg px-5 py-4">
      {isAdmin ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-green-700">
            <ShieldCheck className="w-4 h-4" />
            <span>Admin access active — you can change global provider and model settings.</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLock} disabled={busy}>Lock</Button>
        </div>
      ) : (
        <form onSubmit={handleUnlock} className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-stone-600">
            <Lock className="w-4 h-4 text-stone-400" />
            <span>Global settings changes require admin access.</span>
          </div>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-48 h-8 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !password}>
            {busy ? 'Unlocking…' : 'Unlock admin access'}
          </Button>
          {error && <span className="text-xs text-red-600">{error}</span>}
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
      <p className="text-sm text-stone-500">
        API keys are read from Replit Secrets. To add a key, open the Secrets panel in Replit and add the environment variable shown below.
        Content generation falls back to demo mode if no provider is configured.
      </p>

      {!providers?.length && (
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">
          No providers configured.
        </div>
      )}

      {providers?.map(provider => {
        const meta = PROVIDER_ENV_KEYS[provider.name] ?? {};
        const testResult = testResults[provider.name];

        return (
          <div key={provider.name} className="bg-white border border-stone-200 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-semibold text-stone-800">{provider.displayName}</p>
                  {provider.isConfigured ? (
                    <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Configured</Badge>
                  ) : (
                    <Badge variant="outline" className="text-stone-400 border-stone-200 text-xs">Not configured</Badge>
                  )}
                </div>
                <p className="text-xs text-stone-400 mb-2">{provider.description}</p>
                {meta.key && (
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-stone-100 text-stone-600 px-2 py-1 rounded font-mono">{meta.key}</code>
                    {meta.docs && (
                      <a href={meta.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-[#C8102E] hover:underline">
                        Get API key →
                      </a>
                    )}
                  </div>
                )}
                {provider.isConfigured && provider.availableModels && (
                  <p className="text-xs text-stone-400 mt-2">Models: {provider.availableModels.slice(0, 4).join(', ')}{provider.availableModels.length > 4 ? '…' : ''}</p>
                )}
              </div>
              {provider.isConfigured && (
                <Button size="sm" variant="outline" onClick={() => handleTest(provider.name)} disabled={testing === provider.name}>
                  {testing === provider.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Test Connection'}
                </Button>
              )}
            </div>

            {testResult && (
              <div className={`mt-3 flex items-start gap-2 p-3 rounded text-xs ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                <span>{testResult.message}{testResult.latencyMs > 0 ? ` (${testResult.latencyMs}ms)` : ''}</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Demo mode notice */}
      <div className="bg-stone-50 border border-stone-100 rounded-lg p-4">
        <p className="text-xs font-semibold text-stone-600 mb-1">Demo Mode</p>
        <p className="text-xs text-stone-400">
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

  if (isLoading) return <div className="h-32 bg-stone-100 animate-pulse rounded-lg" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-stone-800">Pipeline Model Assignment</h3>
          <p className="text-xs text-stone-400 mt-0.5">Assign specific models to each pipeline stage. Leave blank to use the best available provider automatically.</p>
        </div>
        {!editing && <Button variant="outline" onClick={startEdit}>Edit Config</Button>}
      </div>

      <div className="bg-white border border-stone-200 rounded-lg divide-y divide-stone-100">
        {PIPELINE_STAGES.map(stage => {
          const val = editing ? (form[stage.key] ?? '') : ((config as any)?.[stage.key] ?? '');
          return (
            <div key={stage.key} className="px-5 py-3.5 flex items-center gap-4">
              <div className="w-32 flex-shrink-0">
                <p className="text-sm font-medium text-stone-700">{stage.label}</p>
                <p className="text-xs text-stone-400 leading-snug">{stage.description}</p>
              </div>
              {editing ? (
                <select
                  value={val}
                  onChange={e => setForm(f => ({ ...f, [stage.key]: e.target.value }))}
                  className="flex-1 border border-stone-200 rounded px-3 py-1.5 text-sm"
                >
                  <option value="">Auto (best available)</option>
                  {allModels.map(m => (
                    <option key={`${m.provider}/${m.model}`} value={m.model}>{m.provider} / {m.model}</option>
                  ))}
                </select>
              ) : (
                <span className="flex-1 text-sm text-stone-600 font-mono">{val || <span className="text-stone-300 font-sans not-italic">Auto</span>}</span>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="flex gap-2 items-center flex-wrap">
          <Button onClick={handleSave} disabled={update.isPending} className="bg-[#C8102E] hover:bg-[#a80d25] text-white">{update.isPending ? 'Saving…' : 'Save Config'}</Button>
          <Button variant="outline" onClick={() => { setEditing(false); setSaveError(null); }}>Cancel</Button>
          {saveError && <span className="text-xs text-red-600">{saveError}</span>}
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
    installed: 'bg-green-50 text-green-700',
    not_installed: 'bg-stone-100 text-stone-500',
    optional: 'bg-blue-50 text-blue-600',
    deprecated: 'bg-red-50 text-red-500',
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-stone-800 mb-1">Dependency Registry</h3>
        <p className="text-xs text-stone-400">All planned and optional dependencies for the content pipeline. Each entry tracks its install status, purpose, and decision rationale.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${filter === cat ? 'bg-[#C8102E] text-white border-[#C8102E]' : 'border-stone-200 text-stone-500 hover:border-stone-300'}`}
          >
            {cat === 'all' ? 'All' : cat}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {!filtered.length && (
          <div className="bg-white border border-stone-200 rounded-lg p-8 text-center text-stone-400 text-sm">
            No dependency results found.
          </div>
        )}
        {filtered.map(dep => (
          <div key={dep.id} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedId(expandedId === dep.id ? null : dep.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-stone-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-700">{dep.componentName}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColors[dep.installStatus ?? ''] ?? 'bg-stone-100 text-stone-500'}`}>{dep.installStatus}</span>
                </div>
                <p className="text-xs text-stone-400 mt-0.5 line-clamp-1">{dep.purpose}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-stone-300">{dep.category}</span>
                {expandedId === dep.id ? <ChevronDown className="w-3.5 h-3.5 text-stone-300" /> : <ChevronRight className="w-3.5 h-3.5 text-stone-300" />}
              </div>
            </button>
            {expandedId === dep.id && (
              <div className="px-4 pb-4 border-t border-stone-50 pt-3 space-y-2">
                {dep.repositorySlug && <p className="text-xs text-stone-400">Repository: <a href={`https://github.com/${dep.repositorySlug}`} target="_blank" rel="noopener noreferrer" className="text-[#C8102E] hover:underline">{dep.repositorySlug}</a></p>}
                {dep.decisionReason && <p className="text-xs text-stone-500">{dep.decisionReason}</p>}
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
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#111] font-serif">Settings</h1>
        <p className="text-stone-500 mt-1 text-sm">Configure AI providers, model assignments, and system dependencies</p>
      </div>

      <div className="border-b border-stone-200 mb-6">
        <div className="flex gap-0">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-[#C8102E] text-[#C8102E]' : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <AdminAccessCard />

      {activeTab === 'AI Providers' && <ProvidersTab />}
      {activeTab === 'Model Configuration' && <ModelConfigTab />}
      {activeTab === 'Dependencies' && <DependenciesTab />}
      {activeTab === 'Automation' && <AutomationTab />}
    </div>
  );
}
