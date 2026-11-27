import { adminApi, readInput } from "@/server/api";
import { createProfessor, listProfessors } from "@/services/professors";
import { createProfessorSchema } from "@/validations/management";
export async function GET(request: Request) { return adminApi(request, async () => listProfessors()); }
export async function POST(request: Request) {
  return adminApi(request, async admin => createProfessor(await readInput(request, createProfessorSchema), admin), 201);
}
