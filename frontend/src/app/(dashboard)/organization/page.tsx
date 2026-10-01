import { Building2, Users, Shield, Plus, Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";

export default function OrganizationPage() {
  const members = [
    {
      name: "Dr. Dipankar Sarma",
      email: "doctor.dipankar@brahmaputrahealth.com",
      role: "Clinic Owner & Admin",
      status: "Active",
    },
    {
      name: "Rupali Das",
      email: "reception@brahmaputrahealth.com",
      role: "Front Desk Staff",
      status: "Active",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Organization Profile & Members
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage multi-tenant clinic information, staff roles, and access permissions.
          </p>
        </div>

        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          <span>Invite Member</span>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Org Summary */}
        <Card className="md:col-span-1">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">Clinic Details</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Tenant identifier and business identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="space-y-1">
              <span className="text-muted-foreground">Organization Name</span>
              <p className="font-semibold text-foreground">Brahmaputra Health Clinic</p>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">Tenant ID</span>
              <p className="font-mono text-xs text-muted-foreground">org-default-001</p>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground">Location</span>
              <p className="text-foreground">Guwahati, Assam, India</p>
            </div>
            <div className="space-y-1 pt-2 border-t">
              <span className="text-muted-foreground">Plan Status</span>
              <div className="pt-1">
                <Badge variant="success">Active Tenant</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Members Roster */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center space-x-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">Staff & Team Members</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Authorized users with dashboard access for OPD operations.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {members.map((m) => (
                <div key={m.email} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center space-x-3 truncate">
                    <Avatar name={m.name} className="h-9 w-9 text-xs" />
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-semibold text-foreground truncate">{m.name}</span>
                      <span className="text-xs text-muted-foreground flex items-center space-x-1 truncate">
                        <Mail className="h-3 w-3 inline shrink-0" />
                        <span className="truncate">{m.email}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs font-medium text-foreground">{m.role}</div>
                      <Badge variant="outline" className="text-[10px] mt-0.5">
                        {m.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
