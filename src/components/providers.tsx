"use client";

import { App, ConfigProvider } from "antd";
import frFR from "antd/locale/fr_FR";
import { SessionProvider } from "next-auth/react";
import "@/lib/dates";

export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider><ConfigProvider locale={frFR} theme={{ token: {
    colorPrimary: "#2256d8", colorSuccess: "#177f69", colorWarning: "#b77918",
    colorText: "#18243c", colorTextSecondary: "#657087", colorBorderSecondary: "#e9edf4",
    borderRadius: 10, fontSize: 16, fontFamily: "'Segoe UI', system-ui, sans-serif",
  }, components: { Button: { controlHeight: 42 }, Card: { paddingLG: 24 } } }}>
    <App>{children}</App>
  </ConfigProvider></SessionProvider>;
}
