import { useState } from 'react';
import { Newspaper } from 'lucide-react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        setError('Incorrect password. Please try again.');
      }
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9F8F6] flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 bg-[#C8102E] rounded flex items-center justify-center flex-shrink-0">
            <Newspaper className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-widest uppercase text-[#111] font-serif">
              Content OS
            </p>
            <p className="text-xs text-stone-400 leading-none mt-0.5">Editorial Suite</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white border border-stone-200 rounded-lg p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-stone-900 mb-1">Sign in</h1>
          <p className="text-sm text-stone-500 mb-6">Enter your team password to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-stone-700 mb-1.5"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#C8102E] focus:border-transparent"
                placeholder="Team password"
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-[#C8102E] text-white text-sm font-medium py-2 px-4 rounded hover:bg-[#a00c24] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
