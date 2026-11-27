import { revalidatePath } from "next/cache";
import { adminApi, readInput } from "@/server/api";
import { getCentreSettings, updateCentreSettings } from "@/services/settings";
import { centreSettingsSchema } from "@/validations/settings";

export async function GET(request: Request) {
  return adminApi(request, async () => getCentreSettings());
}

export async function PATCH(request: Request) {
  return adminApi(request, async actor => {
    const result = await updateCentreSettings(await readInput(request, centreSettingsSchema), actor);
    revalidatePath("/", "layout");
    return result;
  });
}
