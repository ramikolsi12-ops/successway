import { adminApi } from "@/server/api";
import { getPayment } from "@/services/payments";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminApi(request, async () => getPayment((await params).id));
}
