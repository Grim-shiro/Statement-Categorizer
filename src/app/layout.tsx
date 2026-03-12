import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Budget Categorizer",
  description: "Smart transaction categorization for accountants",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-100 min-h-screen antialiased">{children}</body>
    </html>
  );
}
