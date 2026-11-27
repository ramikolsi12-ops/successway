import { adminApi, readInput } from "@/server/api";
import { updateAgendaSession } from "@/services/agenda";
import { sessionEditSchema } from "@/validations/agenda";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => updateAgendaSession((await params).id, await readInput(request, sessionEditSchema), actor));
}
