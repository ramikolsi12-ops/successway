import { notFound } from "next/navigation";
import { requireAdministrator } from "@/server/authorization";
import { professorDetails } from "@/services/professors";
import { ProfessorProfile } from "@/features/professors/professor-profile";
import { BusinessError } from "@/lib/business-error";
import { uuidSchema } from "@/validations/management";
export const metadata = { title: "Fiche professeur" };
export default async function ProfessorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireAdministrator();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const requestedTab = (await searchParams).tab;
  const tab = requestedTab && ["informations", "tarification", "seances", "paiements", "statistiques"].includes(requestedTab) ? requestedTab : "informations";
  const profile = await professorDetails(id).catch(error => {
    if (error instanceof BusinessError && error.status === 404) notFound();
    throw error;
  });
  return <ProfessorProfile initialData={profile} initialTab={tab} />;
}
