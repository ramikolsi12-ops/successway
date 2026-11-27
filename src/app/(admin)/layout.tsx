import { requireAdministrator } from "@/server/authorization";
import { AppShell } from "@/components/app-shell";
import { getCentreBranding } from "@/services/settings";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdministrator();
  return <AppShell displayName={admin.displayName} branding={await getCentreBranding()}>{children}</AppShell>;
}
