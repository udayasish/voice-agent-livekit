import Link from "next/link";
import { PhoneCall, Search, Filter, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default function CallsPage() {
  const calls = [
    {
      id: "call-2026-001",
      caller: "+91 98540 12345",
      language: "Assamese (as-IN)",
      doctor: "Dr. Dipankar Sarma",
      outcome: "Appointment Booked",
      duration: "1m 32s",
      date: "2026-10-01 10:14 AM",
      status: "success",
    },
    {
      id: "call-2026-002",
      caller: "+91 94350 67890",
      language: "Assamese / Hindi",
      doctor: "Dr. Ananya Baruah",
      outcome: "Slot Inquiry Only",
      duration: "0m 58s",
      date: "2026-10-01 09:45 AM",
      status: "secondary",
    },
    {
      id: "call-2026-003",
      caller: "+91 88760 99887",
      language: "English / Assamese",
      doctor: "General OPD",
      outcome: "Transferred to Human",
      duration: "3m 15s",
      date: "2026-10-01 09:12 AM",
      status: "warning",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Inbound Call Logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Review voice calls, speech recognition transcripts, and AI booking outcomes.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search phone number..." className="pl-9 text-xs" />
          </div>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-1.5" />
            <span>Filter</span>
          </Button>
        </div>
      </div>

      {/* Table Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">All Call Sessions</CardTitle>
          <CardDescription className="text-xs">
            Showing latest inbound calls handled by the Voice Agent Engine.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="p-3.5 font-medium">Caller</th>
                  <th className="p-3.5 font-medium">Language</th>
                  <th className="p-3.5 font-medium">Doctor / Department</th>
                  <th className="p-3.5 font-medium">Duration</th>
                  <th className="p-3.5 font-medium">Outcome</th>
                  <th className="p-3.5 font-medium">Timestamp</th>
                  <th className="p-3.5 font-medium text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {calls.map((call) => (
                  <tr key={call.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3.5 font-medium text-foreground">
                      <div className="flex items-center space-x-2">
                        <PhoneCall className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{call.caller}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-muted-foreground">{call.language}</td>
                    <td className="p-3.5 text-foreground">{call.doctor}</td>
                    <td className="p-3.5 text-muted-foreground">{call.duration}</td>
                    <td className="p-3.5">
                      <Badge
                        variant={
                          call.status === "success"
                            ? "success"
                            : call.status === "warning"
                            ? "warning"
                            : "secondary"
                        }
                        className="text-[11px]"
                      >
                        {call.outcome}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-muted-foreground">{call.date}</td>
                    <td className="p-3.5 text-right">
                      <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                        <Link href={`/calls/${call.id}`}>
                          <span>View</span>
                          <ArrowUpRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
