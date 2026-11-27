import { revalidatePath } from "next/cache";
import { adminApi, readRequestBytes } from "@/server/api";
import { maximumLogoBytes, removeCentreLogo, setCentreLogo } from "@/services/settings";

export async function POST(request: Request) {
  return adminApi(request, async actor => {
    const result = await setCentreLogo(Buffer.from(await readRequestBytes(request, maximumLogoBytes)), actor);
    revalidatePath("/", "layout");
    return result;
  });
}

export async function DELETE(request: Request) {
  return adminApi(request, async actor => {
    const result = await removeCentreLogo(actor);
    revalidatePath("/", "layout");
    return result;
  });
}
