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
  const { setMobileNavOpen, agentFormDirty, voiceSessionBusy, setAgentFormDirty } = useUiStore();
  const { user, activeOrganization, organizations, setActiveOrganization, clearAuth } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  // Generate readable title from pathname
  const pageTitle = React.useMemo(() => {
    if (pathname === "/") return "Dashboard";
    if (pathname.startsWith("/agents")) return pathname.endsWith("/testing") ? "Test Voice" : "Agents";
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

  const orgName = activeOrganization?.name ?? "No organization";

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
        {/* Organization Context Pill */}
        <div className="flex items-center space-x-1.5 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[160px] truncate text-foreground">
            {organizations.length>1?<select aria-label="Organization" disabled={voiceSessionBusy} value={activeOrganization?.id??""} onChange={event=>{if(agentFormDirty&&!window.confirm("Discard unsaved settings and switch organization?"))return;const org=organizations.find(x=>x.id===event.target.value);if(org){setAgentFormDirty(false);setActiveOrganization(org);router.push('/agents');}}}>{organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select>:orgName}
          </span>
        </div>

        {/* User Info & Logout Action */}
        <div className="flex items-center space-x-2 pl-2 border-l">
          <Avatar name={user?.name ?? "Account"} className="h-8 w-8 text-xs border" />
          <div className="hidden xl:flex flex-col text-left">
            <span className="text-xs font-semibold leading-tight text-foreground truncate max-w-[120px]">
              {user?.name ?? "Account"}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {activeOrganization?.role ?? ""}
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
