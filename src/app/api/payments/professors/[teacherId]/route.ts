import { adminApi } from "@/server/api";
import { getProfessorFinance } from "@/services/payments";

export async function GET(request: Request, { params }: { params: Promise<{ teacherId: string }> }) {
  return adminApi(request, async () => getProfessorFinance((await params).teacherId));
}
