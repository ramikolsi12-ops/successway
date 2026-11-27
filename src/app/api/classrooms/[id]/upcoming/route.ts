import { adminApi } from "@/server/api";
import { upcomingClassroomSessions } from "@/services/classrooms";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminApi(request, async () => upcomingClassroomSessions((await context.params).id));
}
