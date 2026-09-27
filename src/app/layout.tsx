import type { Metadata } from "next";
import { Workspace } from "@/components/workspace";
import "./globals.css";
export const metadata: Metadata = {
  title: "Synthetica · Understand research",
  description:
    "A private research workspace with original passages, cited AI interpretations, and your own notes.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Workspace>{children}</Workspace>
      </body>
    </html>
  );
}
