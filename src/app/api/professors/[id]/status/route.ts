import { adminApi, readInput } from "@/server/api";
import { setProfessorActive } from "@/services/professors";
import { activationSchema } from "@/validations/management";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminApi(request, async admin => setProfessorActive((await context.params).id, await readInput(request, activationSchema), admin));
}
