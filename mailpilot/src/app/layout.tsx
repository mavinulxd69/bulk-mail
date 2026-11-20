import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "MailPilot — thoughtful, personalized email campaigns",
  description: "Create individual, personalized email campaigns for people you are authorized to contact. Preview, review, and explicitly approve every send.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body className="font-sans">{children}</body></html>);
}
