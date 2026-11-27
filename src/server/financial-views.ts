import "server-only";
import { revalidatePath } from "next/cache";

/** Invalidate server-rendered balances after a committed financial mutation. */
export async function refreshFinancialViews<T>(operation: Promise<T>): Promise<T> {
  const result = await operation;
  revalidatePath("/tableau-de-bord");
  revalidatePath("/paiements");
  revalidatePath("/professeurs");
  revalidatePath("/professeurs/[id]", "page");
  revalidatePath("/emploi-du-temps");
  return result;
}
