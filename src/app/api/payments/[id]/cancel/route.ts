import { adminApi, readInput } from "@/server/api";
import { cancelPayment } from "@/services/payments";
import { paymentCancelSchema } from "@/validations/payments";
import { refreshFinancialViews } from "@/server/financial-views";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => refreshFinancialViews(cancelPayment((await params).id, await readInput(request, paymentCancelSchema), actor)));
}
