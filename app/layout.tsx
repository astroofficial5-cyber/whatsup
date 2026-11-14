import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whatsup — Chat simply",
  description: "Private, real-time conversations.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Sets the theme before the first paint so a dark-mode user never sees a white flash.
const themeScript = `try{var t=localStorage.getItem('whatsup-theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
