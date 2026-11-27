import { adminApi, readInput } from "@/server/api";
import { classroomDetails, updateClassroom } from "@/services/classrooms";
import { classroomFields } from "@/validations/management";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return adminApi(request, async () => classroomDetails((await context.params).id));
}
export async function PATCH(request: Request, context: Context) {
  return adminApi(request, async admin => updateClassroom((await context.params).id, await readInput(request, classroomFields), admin));
}
