import { requireAdministrator } from "@/server/authorization";
import { listClassrooms } from "@/services/classrooms";
import { ClassroomManagement } from "@/features/classrooms/classroom-management";

export const metadata = { title: "Salles" };
export default async function ClassroomsPage() {
  await requireAdministrator();
  return <ClassroomManagement initialData={await listClassrooms()} />;
}
