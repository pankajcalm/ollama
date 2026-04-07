import { Link } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";

export function AppShell({
  sidebar,
  children,
}: React.PropsWithChildren<{
  sidebar: React.ReactNode;
}>) {
  const { settings, setSettings } = useSettings();

  return (
    <div className="flex h-screen bg-[var(--app-bg)] text-[var(--app-fg)]">
      <aside
        className={`border-r border-[var(--app-border)] bg-[var(--panel-bg)] transition-all duration-300 ${settings.sidebarOpen ? "w-76" : "w-0 overflow-hidden"}`}
      >
        {settings.sidebarOpen && (
          <div className="flex h-full min-h-0 flex-col">{sidebar}</div>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col"> 
        <header className="flex h-13 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--panel-bg)] px-3">
          <button
            onClick={() => setSettings({ SidebarOpen: !settings.sidebarOpen })}
            className="rounded-md p-2 text-[var(--muted-fg)] hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            aria-label={settings.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link
            to="/c/$chatId"
            params={{ chatId: "new" }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            New chat
          </Link>
        </header>
        {children}
      </main>
    </div>
  );
}
