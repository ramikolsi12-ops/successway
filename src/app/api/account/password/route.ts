import { adminApi, readInput } from "@/server/api";
import { passwordChangeSchema } from "@/validations/auth";
import { changeAdministratorPassword } from "@/services/account-security";

export async function POST(request: Request) {
  return adminApi(request, async actor => changeAdministratorPassword(await readInput(request, passwordChangeSchema), actor));
}
