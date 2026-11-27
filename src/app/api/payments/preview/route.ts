import { adminApi, readInput } from "@/server/api";
import { previewPayment } from "@/services/payments";
import { paymentInputSchema } from "@/validations/payments";

export async function POST(request: Request) {
  return adminApi(request, async () => previewPayment(await readInput(request, paymentInputSchema)));
}
