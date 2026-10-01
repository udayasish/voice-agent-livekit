"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Building2,
  Radio,
} from "lucide-react";
import { navigationConfig } from "@/config/navigation";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
  const pathname = usePathname();
  const { isSidebarCollapsed, toggleSidebar, activeOrgName } = useUiStore();

  return (
    <aside
      aria-label="Sidebar navigation"
      className={cn(
        "relative hidden md:flex flex-col border-r bg-card transition-all duration-300 ease-in-out select-none",
        isSidebarCollapsed ? "w-[72px]" : "w-64",
      )}
    >
      {/* Brand & Organization Header */}
      <div className="flex h-16 items-center border-b px-4 justify-between">
        {!isSidebarCollapsed ? (
          <div className="flex items-center space-x-2.5 overflow-hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex flex-col truncate">
              <span className="text-sm font-semibold tracking-tight text-foreground truncate">
                Voice Agent AI
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center space-x-1 truncate">
                <Building2 className="h-3 w-3 inline shrink-0" />
                <span className="truncate">{activeOrgName}</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "h-7 w-7 text-muted-foreground hover:text-foreground",
            isSidebarCollapsed && "absolute -right-3.5 top-5 z-20 h-6 w-6 rounded-full border bg-background shadow-md",
          )}
        >
          {isSidebarCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navigationConfig.map((section, idx) => (
          <div key={section.title ?? idx} className="space-y-1">
            {section.title && !isSidebarCollapsed && (
              <h4 className="px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h4>
            )}

            <div className="space-y-1 pt-1">
              {section.items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={isSidebarCollapsed ? item.title : undefined}
                    className={cn(
                      "flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-all group",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      isSidebarCollapsed && "justify-center px-0 h-10 w-10 mx-auto",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform",
                        isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground",
                        !isSidebarCollapsed && "mr-3",
                      )}
                    />

                    {!isSidebarCollapsed && (
                      <span className="flex-1 truncate">{item.title}</span>
                    )}

                    {!isSidebarCollapsed && item.badge && (
                      <Badge
                        variant={isActive ? "secondary" : "outline"}
                        className={cn(
                          "ml-auto text-[10px] px-1.5 py-0",
                          isActive && "bg-primary-foreground/20 text-primary-foreground border-transparent",
                        )}
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer System Status */}
      <div className="border-t p-3 bg-muted/30">
        {!isSidebarCollapsed ? (
          <div className="flex items-center space-x-2.5 rounded-lg border bg-background px-3 py-2">
            <Radio className="h-3.5 w-3.5 text-emerald-500 animate-pulse shrink-0" />
            <div className="flex flex-col truncate">
              <span className="text-xs font-medium text-foreground">Local Dev Engine</span>
              <span className="text-[10px] text-muted-foreground">₹0 Dev Environment</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1" title="Local Dev Engine - Active">
            <Radio className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
          </div>
        )}
      </div>
    </aside>
  );
}
