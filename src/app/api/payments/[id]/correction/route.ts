import { adminApi, readInput } from "@/server/api";
import { correctPayment } from "@/services/payments";
import { paymentCorrectionSchema } from "@/validations/payments";
import { refreshFinancialViews } from "@/server/financial-views";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => refreshFinancialViews(correctPayment((await params).id, await readInput(request, paymentCorrectionSchema), actor)), 201);
}
