import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
export const metadata: Metadata = { title: "MailPilot — personalized email, sent one by one", description: "Connect your own mailbox, import authorized recipients, and send individually personalized campaigns you approve." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className={`${display.variable} ${body.variable} font-sans`}>{children}</body></html>);
}
