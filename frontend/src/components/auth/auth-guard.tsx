"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { authApi } from "@/services/api/auth";
import { ApiError } from "@/services/api/client";
import { Button } from "@/components/ui/button";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, setSession, clearAuth, setLoading } = useAuthStore();
  const { setActiveOrg } = useUiStore();
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;

    async function verifyAuth() {
      if (isAuthenticated && user) {
        setLoading(false);
        return;
      }

      try {
        setErrorMessage(null);
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
          if (err instanceof ApiError && err.statusCode === 401) {
            clearAuth();
            setActiveOrg("", "");
            router.replace("/login");
          } else {
            setErrorMessage("Unable to check your session. Please try again.");
          }
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
  }, [router, isAuthenticated, user, setSession, clearAuth, setLoading, setActiveOrg, attempt]);

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="space-y-4 text-center" role="alert">
          <p>{errorMessage}</p>
          <Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
        </div>
      </div>
    );
  }

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
    return <p className="p-6 text-center" role="status">Returning to sign in...</p>;
  }

  return <>{children}</>;
}
