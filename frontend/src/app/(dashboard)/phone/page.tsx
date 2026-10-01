import { Phone, Radio, Plus, CheckCircle, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function PhonePage() {
  const numbers = [
    {
      phoneNumber: "+91 361 299 8800",
      provider: "Local SIP Trunk (LiveKit SIP)",
      assignedAgent: "OPD Appointment Voice Agent",
      status: "active",
      type: "Inbound Telephony",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Phone Numbers & SIP Trunks
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage inbound PSTN phone lines, SIP dispatch routing, and LiveKit audio trunks.
          </p>
        </div>

        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          <span>Add Phone Number</span>
        </Button>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-semibold">Active Phone Numbers</CardTitle>
            <CardDescription className="text-xs">
              Phone numbers connected to your automated Assamese voice receptionists.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {numbers.map((num) => (
                <div key={num.phoneNumber} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                  <div className="flex items-center space-x-3.5">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <Phone className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-semibold text-foreground">{num.phoneNumber}</span>
                        <Badge variant="success" className="text-[10px]">
                          <Radio className="mr-1 h-2.5 w-2.5 animate-pulse" />
                          Online
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {num.provider} • Routed to <span className="font-medium text-foreground">{num.assignedAgent}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm" className="text-xs">
                      Configure SIP
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Telephony Architecture Note */}
        <Card className="bg-muted/20 border-dashed">
          <CardContent className="p-5 flex items-start space-x-3">
            <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-foreground">Local Development Mode (₹0)</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                During local development, voice testing runs via browser microphone and local SIP softphones through LiveKit Server. Production PSTN carriers (Exotel/Twilio/SIP trunks) are connected in Phase 20-21 without changing the core AI engine.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
