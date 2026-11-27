import { adminApi } from "@/server/api";
import { getSessions } from "@/services/sessions";
export async function GET(request: Request) {
  return adminApi(request, async () => getSessions(Object.fromEntries(new URL(request.url).searchParams)));
}
