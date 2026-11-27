import { requireAdministrator } from "@/server/authorization";
import { getAgenda } from "@/services/agenda";
import { AgendaView } from "@/features/agenda/agenda-view";
export const metadata = { title: "Emploi du temps" };
export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ date?: string; event?: string }> }) {
  await requireAdministrator();
  const { date, event } = await searchParams;
  const initialData = await getAgenda(typeof date === "string" ? date : undefined);
  return <AgendaView key={`${initialData.date}:${event ?? ""}`} initialData={initialData} initialEventId={typeof event === "string" ? event : undefined} />;
}
