"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { authApi } from "@/services/api/auth";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, setSession, clearAuth, setLoading } = useAuthStore();
  const { setActiveOrg } = useUiStore();

  React.useEffect(() => {
    let mounted = true;

    async function verifyAuth() {
      if (isAuthenticated && user) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const data = await authApi.getMe();
        if (mounted) {
          const primaryOrg = data.organizations[0] ?? null;
          setSession(data.user, data.organizations, primaryOrg);
          if (primaryOrg) {
            setActiveOrg(primaryOrg.id, primaryOrg.name);
          }
        }
      } catch (err) {
        if (mounted) {
          clearAuth();
          router.replace("/login");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    verifyAuth();

    return () => {
      mounted = false;
    };
  }, [router, isAuthenticated, user, setSession, clearAuth, setLoading, setActiveOrg]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium text-muted-foreground animate-pulse">
            Verifying organization session...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
