import { adminApi, readInput } from "@/server/api";
import { changeAgendaStatus } from "@/services/agenda";
import { statusChangeSchema } from "@/validations/agenda";
import { refreshFinancialViews } from "@/server/financial-views";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => refreshFinancialViews(changeAgendaStatus((await params).id, await readInput(request, statusChangeSchema), actor)));
}
