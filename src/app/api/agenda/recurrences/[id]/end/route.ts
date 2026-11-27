import { adminApi, readInput } from "@/server/api";
import { endRecurrence } from "@/services/agenda";
import { endRecurrenceSchema } from "@/validations/agenda";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => endRecurrence((await params).id, await readInput(request, endRecurrenceSchema), actor));
}
