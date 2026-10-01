import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
        <AlertCircle className="h-8 w-8 text-amber-500" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        404 — Page Not Found
      </h1>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        The screen or resource you are looking for does not exist or has been moved.
      </p>
      <div className="mt-6">
        <Button asChild>
          <Link href="/" className="inline-flex items-center space-x-2">
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </Link>
        </Button>
      </div>
    </main>
  );
}
