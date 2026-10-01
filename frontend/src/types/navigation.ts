import type { LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string | number;
  description?: string;
  exact?: boolean;
};

export type NavSection = {
  title?: string;
  items: NavItem[];
};
