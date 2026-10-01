import Link from "next/link";
import { MessageSquare, Search, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function ConversationsPage() {
  const conversations = [
    {
      id: "conv-101",
      callId: "call-2026-001",
      caller: "+91 98540 12345",
      turns: 8,
      lastMessage: "আপোনাৰ এপয়েন্টমেন্ট বুক হৈ গৈছে। টোকেন নম্বৰ ৪...",
      time: "10 mins ago",
      topic: "Dr. Dipankar Sarma Appointment",
    },
    {
      id: "conv-102",
      callId: "call-2026-002",
      caller: "+91 94350 67890",
      turns: 4,
      lastMessage: "কাইলৈ পুৱা ৯:০০ বজাত ডাঃ বৰুৱাৰ সময় উপলব্ধ আছে...",
      time: "24 mins ago",
      topic: "Cardiology Timing Inquiry",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Conversation Sessions
          </h1>
          <p className="text-sm text-muted-foreground">
            Multi-turn dialog threads and tool resolution history.
          </p>
        </div>

        <div className="relative w-48 sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search dialogs..." className="pl-9 text-xs" />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Active & Completed Dialogs</CardTitle>
          <CardDescription className="text-xs">
            Review conversational turns, intent recognition, and LLM context state.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between p-4 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center space-x-3 truncate">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col truncate">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-semibold text-foreground">{conv.caller}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {conv.turns} turns
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-lg mt-0.5">
                      {conv.lastMessage}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <span className="text-xs text-muted-foreground hidden sm:inline-block">
                    {conv.time}
                  </span>
                  <Button variant="outline" size="sm" asChild className="h-8 text-xs">
                    <Link href={`/calls/${conv.callId}`}>
                      <span>Inspect</span>
                      <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
