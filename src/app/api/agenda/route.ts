import { adminApi, readInput } from "@/server/api";
import { createAgendaSession, getAgenda } from "@/services/agenda";
import { sessionInputSchema } from "@/validations/agenda";
export async function GET(request: Request) {
  return adminApi(request, async () => getAgenda(new URL(request.url).searchParams.get("date") ?? undefined));
}
export async function POST(request: Request) {
  return adminApi(request, async actor => createAgendaSession(await readInput(request, sessionInputSchema), actor), 201);
}
