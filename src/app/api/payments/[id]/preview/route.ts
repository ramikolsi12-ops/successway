import { adminApi, readInput } from "@/server/api";
import { previewPaymentCorrection } from "@/services/payments";
import { paymentCorrectionPreviewSchema } from "@/validations/payments";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async () => previewPaymentCorrection((await params).id, await readInput(request, paymentCorrectionPreviewSchema)));
}
