import Link from "next/link";
import { ArrowLeft, Save, Bot } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewAgentPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center space-x-2">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/agents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Create New Voice Agent
          </h1>
          <p className="text-xs text-muted-foreground">
            Deploy a dedicated AI voice receptionist with custom tools.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Bot className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Agent Profile</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Basic details, language settings, and voice persona.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Agent Name</label>
            <Input placeholder="e.g. Clinic Reception Desk" defaultValue="OPD Desk Assistant" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Primary Language</label>
            <Input defaultValue="Assamese (as-IN)" disabled />
            <span className="text-[11px] text-muted-foreground">
              Deepgram Nova-3 & AI4Bharat IndicF5 configured for Assamese.
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Initial Greeting (Assamese)</label>
            <Input
              defaultValue="নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেল্থ ক্লিনিকলৈ স্বাগতম। মই কেনেকৈ সহায় কৰিব পাৰোঁ?"
            />
          </div>
        </CardContent>
        <CardFooter className="border-t pt-4 flex justify-end space-x-2">
          <Button variant="outline" asChild size="sm">
            <Link href="/agents">Cancel</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/agents">
              <Save className="h-4 w-4 mr-1.5" />
              <span>Save & Deploy</span>
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
