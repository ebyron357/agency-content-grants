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
    <aside className="w-16 flex-shrink-0 border-r border-stone-200 bg-stone-50 flex flex-col md:w-56">
      <div className="border-b border-stone-200 px-2 py-4 md:px-5 md:pt-6 md:pb-5">
        <div className="flex items-center justify-center gap-2.5 md:justify-start">
          <div className="w-7 h-7 bg-[#C8102E] rounded flex items-center justify-center flex-shrink-0">
            <Newspaper className="w-4 h-4 text-white" />
          </div>
          <div className="hidden md:block">
            <p className="text-xs font-bold tracking-widest uppercase text-[#111] font-serif">Content OS</p>
            <p className="text-[10px] text-stone-400 leading-none mt-0.5">Editorial Suite</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-4 md:px-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = location === href || (href !== '/create' && href !== '/dashboard' && location.startsWith(href));
          return (
            <Link key={href} href={href} className={cn(
              'flex items-center justify-center gap-0 rounded px-2 py-2 text-sm transition-colors md:justify-start md:gap-3 md:px-3',
              active
                ? 'bg-[#C8102E] text-white font-medium'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            )} aria-label={label} title={label}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="space-y-2 border-t border-stone-200 px-2 py-3 md:px-3">
        <div className="flex items-center justify-center px-2 md:justify-end">
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-[#C8102E] md:justify-end"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </div>
        <p className="hidden px-2 text-[10px] text-stone-400 md:block">Multi-brand AI content</p>
      </div>
    </aside>
  );
}
