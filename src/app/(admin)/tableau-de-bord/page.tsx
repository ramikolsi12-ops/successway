import { DashboardView } from "@/components/dashboard-view";
import { getDashboard } from "@/services/dashboard";
import { dashboardMonth } from "@/lib/dashboard";
import { notFound } from "next/navigation";

export const metadata = { title: "Tableau de bord" };
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const { month } = await searchParams;
  if (Array.isArray(month)) notFound();
  try { dashboardMonth(month); } catch { notFound(); }
  return <DashboardView data={await getDashboard(month)} />;
}
