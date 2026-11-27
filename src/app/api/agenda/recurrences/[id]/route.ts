import { adminApi, readInput } from "@/server/api";
import { updateRecurrence } from "@/services/agenda";
import { recurrenceUpdateSchema } from "@/validations/agenda";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => updateRecurrence((await params).id, await readInput(request, recurrenceUpdateSchema), actor));
}
