import { adminApi, readInput } from "@/server/api";
import { createRateAgreement } from "@/services/pricing";
import { rateAgreementSchema } from "@/validations/management";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminApi(request, async admin => createRateAgreement((await context.params).id, await readInput(request, rateAgreementSchema), admin), 201);
}
