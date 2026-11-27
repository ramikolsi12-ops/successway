import { requireAdministrator } from "@/server/authorization";
import { listProfessors } from "@/services/professors";
import { ProfessorsView } from "@/features/professors/professors-view";
export const metadata = { title: "Professeurs" };
export default async function ProfessorsPage() {
  await requireAdministrator();
  return <ProfessorsView initialData={await listProfessors()} />;
}
