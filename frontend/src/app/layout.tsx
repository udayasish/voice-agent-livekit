import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Voice Agent Platform | Assamese AI Voice Agent",
  description:
    "Multi-tenant AI voice-agent platform for businesses in Assam and Northeast India",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-background font-sans text-foreground antialiased flex flex-col">
        {children}
      </body>
    </html>
  );
}
