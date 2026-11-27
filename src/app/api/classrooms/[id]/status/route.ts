import { adminApi, readInput } from "@/server/api";
import { setClassroomActive } from "@/services/classrooms";
import { activationSchema } from "@/validations/management";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminApi(request, async admin => setClassroomActive((await context.params).id, await readInput(request, activationSchema), admin));
}
