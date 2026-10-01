"use client";

import * as React from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Log client error safely without sensitive data
    console.error("Dashboard error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border bg-card p-8 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400 mb-4">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">
        Something went wrong loading this screen
      </h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-md">
        {error.message || "An unexpected error occurred while rendering the dashboard view."}
      </p>
      <div className="mt-6 flex space-x-3">
        <Button onClick={() => reset()} className="inline-flex items-center space-x-2">
          <RotateCcw className="h-4 w-4" />
          <span>Try Again</span>
        </Button>
      </div>
    </div>
  );
}
