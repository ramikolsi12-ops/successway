import { adminApi, readInput } from "@/server/api";
import { createClassroom, listClassrooms } from "@/services/classrooms";
import { createClassroomSchema } from "@/validations/management";

export async function GET(request: Request) {
  return adminApi(request, async () => {
    const query = new URL(request.url).searchParams;
    return listClassrooms(query.has("startAt") || query.has("endAt") ? { startAt: query.get("startAt"), endAt: query.get("endAt") } : undefined);
  });
}
export async function POST(request: Request) {
  return adminApi(request, async admin => createClassroom(await readInput(request, createClassroomSchema), admin), 201);
}
