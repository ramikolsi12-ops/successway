import { adminApi, readInput } from "@/server/api";
import { professorDetails, updateProfessor } from "@/services/professors";
import { professorFields } from "@/validations/management";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return adminApi(request, async () => professorDetails((await context.params).id));
}
export async function PATCH(request: Request, context: Context) {
  return adminApi(request, async admin => updateProfessor((await context.params).id, await readInput(request, professorFields), admin));
}
