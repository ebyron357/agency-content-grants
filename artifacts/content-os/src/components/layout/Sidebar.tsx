import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Building2, FolderKanban, Settings, Newspaper, Plus, LogOut, Send, LineChart } from 'lucide-react';
import { cn } from '@/lib/utils';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const nav = [
  { href: '/create', label: 'New Content', icon: Plus },
  { href: '/projects', label: 'Documents', icon: FolderKanban },
  { href: '/brands', label: 'Brands', icon: Building2 },
  { href: '/distribution', label: 'Distribution', icon: Send },
  { href: '/performance', label: 'Performance', icon: LineChart },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  const handleSignOut = async () => {
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
    } finally {
      window.location.reload();
    }
  };

  return (
    <aside className="w-56 flex-shrink-0 border-r border-stone-200 bg-stone-50 flex flex-col">
      {/* Masthead */}
      <div className="px-5 pt-6 pb-5 border-b border-stone-200">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-[#C8102E] rounded flex items-center justify-center flex-shrink-0">
            <Newspaper className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-[#111] font-serif">Content OS</p>
            <p className="text-[10px] text-stone-400 leading-none mt-0.5">Editorial Suite</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== '/create' && href !== '/dashboard' && location.startsWith(href));
          return (
            <Link key={href} href={href} className={cn(
              'flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors',
              active
                ? 'bg-[#C8102E] text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            )}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-stone-200 space-y-2">
        <div className="flex items-center justify-end px-2">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-[#C8102E] transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
        <p className="text-[10px] text-stone-400 px-2">Multi-brand AI content</p>
      </div>
    </aside>
  );
}
