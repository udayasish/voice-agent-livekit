"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  Building2,
  Cpu,
  LogOut,
} from "lucide-react";
import { useUiStore } from "@/store/ui-store";
import { useAuthStore } from "@/store/auth-store";
import { authApi } from "@/services/api/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setMobileNavOpen } = useUiStore();
  const { user, activeOrganization, clearAuth } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  // Generate readable title from pathname
  const pageTitle = React.useMemo(() => {
    if (pathname === "/") return "Overview";
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "Dashboard";
    return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
  }, [pathname]);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await authApi.logout();
    } catch {
      // Even if network fails, clear local state and redirect
    } finally {
      clearAuth();
      router.replace("/login");
    }
  };

  const orgName = activeOrganization?.name ?? "Brahmaputra Health Clinic";

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-background/95 px-4 md:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center space-x-3">
        {/* Mobile Hamburger Menu Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden text-muted-foreground hover:text-foreground"
          aria-label="Open mobile menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Page Title & Breadcrumb */}
        <div className="flex items-center space-x-2">
          <span className="text-base font-semibold text-foreground tracking-tight">
            {pageTitle}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline-block">
            / Assamese Voice AI
          </span>
        </div>
      </div>

      {/* Right Actions: Environment, Organization & User */}
      <div className="flex items-center space-x-3">
        {/* Environment Badge */}
        <Badge
          variant="outline"
          className="hidden lg:flex items-center space-x-1.5 text-xs font-normal border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 py-1"
        >
          <Cpu className="h-3 w-3" />
          <span>Local ₹0 Dev</span>
        </Badge>

        {/* Organization Context Pill */}
        <div className="hidden sm:flex items-center space-x-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[160px] truncate text-foreground">
            {orgName}
          </span>
        </div>

        {/* User Info & Logout Action */}
        <div className="flex items-center space-x-2 pl-2 border-l">
          <Avatar name={user?.name ?? "Clinic Admin"} className="h-8 w-8 text-xs border" />
          <div className="hidden xl:flex flex-col text-left">
            <span className="text-xs font-semibold leading-tight text-foreground truncate max-w-[120px]">
              {user?.name ?? "Clinic Admin"}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {activeOrganization?.role ?? "Owner"}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 h-8"
            title="Sign out of dashboard"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden md:inline-block ml-1.5 text-xs">Sign Out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
