import { adminApi, readInput } from "@/server/api";
import { cancelAgendaSession } from "@/services/agenda";
import { cancellationSchema } from "@/validations/agenda";
import { refreshFinancialViews } from "@/server/financial-views";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => refreshFinancialViews(cancelAgendaSession((await params).id, await readInput(request, cancellationSchema), actor)));
}
