import {
  LayoutDashboard,
  LibraryBig,
  Users,
  Frame,
  Truck,
  MapPin,
  FileText,
  BarChart3,
  Settings,
  Star,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string; // i18n key under `nav`
  href: string; // relative to locale root
  icon: LucideIcon;
}

export interface NavSection {
  labelKey: string; // i18n key under `nav`
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: 'sectionMain',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'collection', href: '/collection', icon: LibraryBig },
      { key: 'favorites', href: '/favorites', icon: Star },
    ],
  },
  {
    labelKey: 'sectionManage',
    items: [
      { key: 'artists', href: '/artists', icon: Users },
      { key: 'exhibitions', href: '/exhibitions', icon: Frame },
      { key: 'loans', href: '/loans', icon: Truck },
      { key: 'locations', href: '/locations', icon: MapPin },
      { key: 'documents', href: '/documents', icon: FileText },
      { key: 'reports', href: '/reports', icon: BarChart3 },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  key: 'settings',
  href: '/settings',
  icon: Settings,
};
