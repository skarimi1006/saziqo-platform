'use client';

import { Header } from './header';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Header />

      {/* Sidebar: fixed to start (visual right in RTL), below header */}
      <div className="fixed bottom-0 start-0 top-14 hidden w-64 border-e bg-sidebar md:block">
        <Sidebar />
      </div>

      {/* Main: offset by sidebar width on desktop */}
      <main className="pt-14 md:ms-64">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
