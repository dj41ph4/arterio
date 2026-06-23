'use client';

import { LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useAuthStore } from '@/stores/auth-store';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··';
}

export function UserMenu() {
  const t = useTranslations();
  const router = useRouter();
  const { data: user } = useCurrentUser();
  const clearAuth = useAuthStore((s) => s.clear);

  const displayName = user?.fullName ?? '—';
  const initials = user ? initialsOf(user.fullName) : '··';
  const isAdmin = user?.roles.includes('admin') ?? false;

  function handleLogout() {
    clearAuth();
    router.push('/login');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <Avatar className="size-8 ring-2 ring-background transition-transform hover:scale-105">
          <AvatarFallback className="bg-primary/15 text-primary">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel className="flex items-center gap-3 normal-case">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary/15 text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{displayName}</span>
            <span className="text-xs font-normal text-muted-foreground">{user?.email ?? ''}</span>
          </div>
        </DropdownMenuLabel>
        {user && (
          <div className="px-2.5 pb-1.5">
            <Badge tone="primary" className="gap-1">
              <ShieldCheck className="size-3" /> {isAdmin ? 'Administrator' : user.roles[0] ?? 'Member'}
            </Badge>
          </div>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserRound /> {t('settings.general')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> {t('nav.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
          <LogOut /> {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
