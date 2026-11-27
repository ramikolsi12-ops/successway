import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { Providers } from "@/components/providers";
import { headers } from "next/headers";
import "antd/dist/reset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Centre Formation Manager", template: "%s · Centre Formation Manager" },
  description: "Gestion administrative de votre centre de formation en Tunisie.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Request-time rendering lets Next.js nonce all framework and RSC scripts.
  await headers();
  return <html lang="fr"><body><AntdRegistry><Providers>{children}</Providers></AntdRegistry></body></html>;
}
