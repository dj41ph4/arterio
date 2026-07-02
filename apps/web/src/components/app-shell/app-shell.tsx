import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { AssistantWidget } from '@/components/assistant/assistant-widget';
import { AuthGuard } from '@/components/auth/auth-guard';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-dvh bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          {/* pb on mobile clears the fixed bottom tab bar */}
          <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
        </div>
        <MobileNav />
        <CommandPalette />
        <AssistantWidget />
      </div>
    </AuthGuard>
  );
}
