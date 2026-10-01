import Link from "next/link";
import { ArrowLeft, PhoneCall, Bot, User, CheckCircle2, Wrench } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;

  const transcript = [
    {
      role: "agent",
      speaker: "AI Receptionist",
      text: "নমস্কাৰ, ব্ৰহ্মপুত্ৰ হেল্থ ক্লিনিকলৈ স্বাগতম। মই কেনেকৈ সহায় কৰিব পাৰোঁ?",
      time: "00:03",
    },
    {
      role: "user",
      speaker: "Caller",
      text: "নমস্কাৰ, ডাঃ দীপংকৰ শৰ্মা ডাঙৰীয়াৰ লগত এটা এপয়েন্টমেন্ট লাগিছিল কাইলৈৰ বাবে।",
      time: "00:12",
    },
    {
      role: "tool",
      name: "get_available_slots",
      args: { doctorId: "doc-01", date: "2026-10-02" },
      result: { availableSlots: ["10:00 AM", "10:30 AM", "11:00 AM"] },
    },
    {
      role: "agent",
      speaker: "AI Receptionist",
      text: "নিশ্চয়, কাইলৈ পুৱা ১০:০০ বজাত আৰু ১০:৩০ বজাত সময় উপলব্ধ আছে। আপোনাৰ বাবে কোনটো সুবিধাজনক হ'ব?",
      time: "00:22",
    },
    {
      role: "user",
      speaker: "Caller",
      text: "১০:০০ বজাৰ সময়টো বুক কৰি দিয়ক। নাম বিক্ৰম শইকীয়া।",
      time: "00:31",
    },
    {
      role: "tool",
      name: "book_appointment",
      args: { doctorId: "doc-01", slotTime: "10:00 AM", patientName: "Bikram Saikia" },
      result: { success: true, tokenNumber: 4, appointmentId: "apt-889" },
    },
    {
      role: "agent",
      speaker: "AI Receptionist",
      text: "আপোনাৰ এপয়েন্টমেন্ট বুক হৈ গৈছে। টোকেন নম্বৰ ৪, পুৱা ১০:০০ বজাত। ক্লিনিকলৈ অহাৰ বাবে ধন্যবাদ!",
      time: "00:44",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" asChild className="h-8 w-8">
          <Link href="/calls">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Call Session: {callId}
            </h1>
            <Badge variant="success">Completed</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Inbound Assamese voice conversation with transactional tool execution.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Transcript View */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base font-semibold">
                Conversation Transcript & Tool Traces
              </CardTitle>
              <CardDescription className="text-xs">
                Real-time speech recognition (Deepgram Nova-3 as-IN) and voice response timeline.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {transcript.map((item, idx) => {
                if (item.role === "tool") {
                  return (
                    <div
                      key={idx}
                      className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs font-mono space-y-1"
                    >
                      <div className="flex items-center space-x-1.5 text-primary font-semibold">
                        <Wrench className="h-3.5 w-3.5" />
                        <span>Tool Invocation: {item.name}()</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Args: {JSON.stringify(item.args)}
                      </div>
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        Result: {JSON.stringify(item.result)}
                      </div>
                    </div>
                  );
                }

                const isAgent = item.role === "agent";

                return (
                  <div
                    key={idx}
                    className={`flex space-x-3 ${isAgent ? "items-start" : "items-start flex-row-reverse space-x-reverse"}`}
                  >
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                        isAgent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isAgent ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    </div>

                    <div
                      className={`rounded-xl p-3.5 text-xs max-w-[80%] space-y-1 ${
                        isAgent ? "bg-muted/50 border text-foreground" : "bg-primary text-primary-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] opacity-75">
                        <span className="font-semibold">{item.speaker}</span>
                        <span>{item.time}</span>
                      </div>
                      <p className="leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Right: Call Metadata Card */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Call Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Caller Number</span>
                <span className="font-medium text-foreground">+91 98540 12345</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium text-foreground">1m 32s</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Primary Language</span>
                <span className="font-medium text-foreground">Assamese (as-IN)</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Agent</span>
                <span className="font-medium text-foreground">OPD Assistant</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Token Generated</span>
                <Badge variant="success">Token #4</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Doctor Assigned</span>
                <span className="font-medium text-foreground">Dr. Dipankar Sarma</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
