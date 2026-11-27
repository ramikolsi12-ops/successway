import { adminApi, readInput } from "@/server/api";
import { getPaymentsOverview, recordPayment } from "@/services/payments";
import { paymentCommandSchema } from "@/validations/payments";
import { refreshFinancialViews } from "@/server/financial-views";
export async function GET(request: Request) {
  return adminApi(request, async () => getPaymentsOverview());
}
export async function POST(request: Request) {
  return adminApi(request, async actor => refreshFinancialViews(recordPayment(await readInput(request, paymentCommandSchema), actor)), 201);
}
