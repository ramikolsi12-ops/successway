import { adminApi } from "@/server/api";
import { listClassrooms } from "@/services/classrooms";
export async function GET(request: Request) {
  return adminApi(request, async () => {
    const query = new URL(request.url).searchParams;
    const data = await listClassrooms({ startAt: query.get("startAt"), endAt: query.get("endAt") });
    return data.rooms.filter(room => room.active && room.availability === "DISPONIBLE");
  });
}
