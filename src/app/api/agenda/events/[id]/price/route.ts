import { adminApi, readInput } from "@/server/api";
import { correctSessionPrice } from "@/services/agenda";
import { priceCorrectionSchema } from "@/validations/payments";
import { refreshFinancialViews } from "@/server/financial-views";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async actor => refreshFinancialViews(correctSessionPrice((await params).id, await readInput(request, priceCorrectionSchema), actor)));
}
