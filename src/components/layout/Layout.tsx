import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Library, 
  BookOpen, 
  Settings, 
  PlusCircle, 
  FolderKanban,
  FileText,
  Search,
  PenTool
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/brands", label: "Brands", icon: Library },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/content-library", label: "Content Library", icon: BookOpen },
  { href: "/research-library", label: "Research", icon: Search },
  { href: "/templates", label: "Templates", icon: FileText },
];

const settingsItems = [
  { href: "/settings/providers", label: "AI Providers", icon: Settings },
  { href: "/settings/models", label: "Model Roles", icon: PenTool },
  { href: "/settings/dependencies", label: "Dependencies", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="flex h-screen w-64 flex-col border-r bg-card px-4 py-6">
      <div className="mb-8 px-2">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-primary">Content OS</h1>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-1">Editorial Studio</p>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto">
        <div>
          <nav className="space-y-1">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    location === item.href || (item.href !== "/" && location.startsWith(item.href))
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <h4 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration
          </h4>
          <nav className="space-y-1">
            {settingsItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
                    location === item.href
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            ))}
          </nav>
        </div>
      </div>
      
      <div className="mt-auto pt-6">
        <Link href="/projects/new">
          <div className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer">
            <PlusCircle className="h-4 w-4" />
            New Project
          </div>
        </Link>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="h-full w-full max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
