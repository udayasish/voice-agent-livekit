"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Sparkles, Building2 } from "lucide-react";
import { navigationConfig } from "@/config/navigation";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function MobileNav() {
  const pathname = usePathname();
  const { isMobileNavOpen, setMobileNavOpen, activeOrgName } = useUiStore();

  // Auto-close drawer on route change
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  if (!isMobileNavOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-out Menu */}
      <div className="relative flex w-4/5 max-w-xs flex-1 flex-col bg-card border-r shadow-2xl p-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center space-x-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold tracking-tight text-foreground">
                Voice Agent AI
              </span>
              <span className="text-[11px] text-muted-foreground flex items-center space-x-1">
                <Building2 className="h-3 w-3 inline" />
                <span className="truncate max-w-[140px]">{activeOrgName}</span>
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close menu"
            className="h-8 w-8 text-muted-foreground"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Links */}
        <div className="flex-1 overflow-y-auto py-4 space-y-6">
          {navigationConfig.map((section, idx) => (
            <div key={section.title ?? idx} className="space-y-1">
              {section.title && (
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
                      className={cn(
                        "flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 mr-3 shrink-0" />
                      <span className="flex-1 truncate">{item.title}</span>
                      {item.badge && (
                        <Badge
                          variant={isActive ? "secondary" : "outline"}
                          className="ml-auto text-[10px]"
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
      </div>
    </div>
  );
}
