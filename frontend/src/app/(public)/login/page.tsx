"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handled in Phase 4 (Authentication & Organization)
  };

  return (
    <Card className="w-full max-w-md shadow-lg border">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Sparkles className="h-6 w-6" />
        </div>
        <CardTitle className="text-xl font-bold tracking-tight">
          Sign In to Voice Agent Platform
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Assamese AI Voice Agent Control Plane for Clinics & Businesses
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Email</label>
            <Input
              type="email"
              placeholder="admin@brahmaputrahealth.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground">Password</label>
              <span className="text-[11px] text-muted-foreground hover:underline cursor-pointer">
                Forgot password?
              </span>
            </div>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-3 pt-2">
          <Button type="submit" className="w-full">
            <span>Sign In</span>
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
          <div className="text-center text-xs text-muted-foreground">
            <span>Phase 2 Foundation: Authentication wiring activated in </span>
            <Link href="/" className="font-semibold text-primary underline">
              Phase 4
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}
