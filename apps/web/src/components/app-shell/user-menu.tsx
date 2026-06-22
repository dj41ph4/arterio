'use client';

import { LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

export function UserMenu() {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        <Avatar className="size-8 ring-2 ring-background transition-transform hover:scale-105">
          <AvatarFallback className="bg-primary/15 text-primary">DA</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel className="flex items-center gap-3 normal-case">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary/15 text-primary">DA</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">Demo Administrator</span>
            <span className="text-xs font-normal text-muted-foreground">admin@arterio.app</span>
          </div>
        </DropdownMenuLabel>
        <div className="px-2.5 pb-1.5">
          <Badge tone="primary" className="gap-1">
            <ShieldCheck className="size-3" /> Administrator
          </Badge>
        </div>
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
        <DropdownMenuItem asChild className="text-destructive focus:text-destructive">
          <Link href="/login">
            <LogOut /> {t('auth.signIn')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
