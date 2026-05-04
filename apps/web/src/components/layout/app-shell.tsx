'use client';

import { Header } from './header';
import { Sidebar } from './sidebar';

interface AppShellProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
}

export function AppShell({ children, sidebar }: AppShellProps) {
  const sidebarContent = sidebar ?? <Sidebar />;

  return (
    <div className="min-h-screen">
      <Header />

      {/* Sidebar: fixed to start (visual right in RTL), below header */}
      <div
        className="fixed bottom-0 start-0 hidden w-64 border-e bg-sidebar md:block"
        style={{ top: 'calc(var(--impersonation-banner-height) + 3.5rem)' }}
      >
        {sidebarContent}
      </div>

      {/* Main: offset by sidebar width on desktop */}
      <main
        className="md:ms-64"
        style={{ paddingTop: 'calc(var(--impersonation-banner-height) + 3.5rem)' }}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
