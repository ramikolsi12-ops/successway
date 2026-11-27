import { adminApi, readInput } from "@/server/api";
import { previewSessionPrice } from "@/services/agenda";
import { priceCorrectionPreviewSchema } from "@/validations/payments";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async () => previewSessionPrice((await params).id, await readInput(request, priceCorrectionPreviewSchema)));
}
