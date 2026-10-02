import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Building2, FolderKanban, Settings, Plus, LogOut, Send, LineChart, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const nav = [
  { href: '/projects', label: 'Documents', icon: FolderKanban },
  { href: '/brands', label: 'Brands', icon: Building2 },
  { href: '/distribution', label: 'Distribution', icon: Send },
  { href: '/performance', label: 'Performance', icon: LineChart },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function isActive(location: string, href: string) {
  if (href === '/dashboard') return location === href;
  return location === href || location.startsWith(`${href}/`);
}

/** The collapsed rail (< md) shows icon-only items, so each gets a tooltip. */
function RailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="md:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const [location] = useLocation();
  const creating = location === '/' || location === '/create';

  const handleSignOut = async () => {
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST' });
    } finally {
      window.location.reload();
    }
  };

  return (
    <aside
      aria-label="Primary"
      className="flex w-16 flex-shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-60"
    >
      <div className="px-2 pb-4 pt-5 md:px-5">
        <Link
          href="/dashboard"
          aria-label="Content OS dashboard"
          className="flex items-center justify-center gap-3 rounded-xl md:justify-start"
        >
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-primary/15 text-brand">
            <PenLine className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="hidden min-w-0 md:block">
            <span className="block text-sm font-semibold tracking-tight text-foreground">Content OS</span>
            <span className="block text-[11px] text-muted-foreground">Editorial command center</span>
          </span>
        </Link>
      </div>

      <div className="px-2 pb-3 md:px-4">
        <RailItem label="New content">
          <Link
            href="/create"
            aria-label="New content"
            aria-current={creating ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90',
              creating && 'ring-2 ring-brand/60 ring-offset-2 ring-offset-sidebar',
            )}
          >
            <Plus className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span className="hidden md:inline">New content</span>
          </Link>
        </RailItem>
      </div>

      <nav aria-label="Workspace" className="flex-1 space-y-1 px-2 py-2 md:px-4">
        <p className="hidden px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground md:block">
          Workspace
        </p>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(location, href);
          return (
            <RailItem key={href} label={label}>
              <Link
                href={href}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-10 items-center justify-center gap-3 rounded-xl px-3 text-sm transition-colors md:justify-start',
                  active
                    ? 'bg-sidebar-accent font-medium text-foreground before:absolute before:left-0 before:top-2 before:h-6 before:w-0.5 before:rounded-full before:bg-brand'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                )}
              >
                <Icon className={cn('h-4 w-4 flex-shrink-0', active && 'text-brand')} aria-hidden="true" />
                <span className="hidden md:inline">{label}</span>
              </Link>
            </RailItem>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-2 py-3 md:px-4">
        <RailItem label="Sign out">
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="flex h-9 w-full items-center justify-center gap-2 rounded-xl px-3 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground md:justify-start"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </RailItem>
      </div>
    </aside>
  );
}
