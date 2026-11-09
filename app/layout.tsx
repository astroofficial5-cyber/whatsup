import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whatsup — Chat simply",
  description: "Private, real-time conversations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
