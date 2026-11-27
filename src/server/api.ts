import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { BusinessError } from "@/lib/business-error";
import { currentAdministrator } from "@/server/authorization";
import { readRequestBytes } from "@/server/request-body";
export { readRequestBytes } from "@/server/request-body";

export type AdminActor = { id: string };

export function assertSameOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const applicationOrigin = new URL(process.env.NEXTAUTH_URL ?? request.url).origin;
  if (!origin || origin !== applicationOrigin) throw new BusinessError("Cette requête n’est pas autorisée.", 403);
}

export async function readInput<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new BusinessError("Envoyez les données au format JSON.", 415);
  }
  const body = await readRequestBytes(request, 64 * 1024);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); } catch { throw new BusinessError("Le contenu de la requête est invalide."); }
  return schema.parse(input);
}

export async function adminApi(request: Request, operation: (admin: AdminActor) => Promise<unknown>, status = 200) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const admin = await currentAdministrator();
    if (!admin) return NextResponse.json({ message: "Votre session a expiré. Reconnectez-vous." }, { status: 401, headers });
    assertSameOrigin(request);
    return NextResponse.json(await operation(admin), { status, headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ message: error.issues[0]?.message ?? "Les données sont invalides.", details: error.flatten() }, { status: 400, headers });
    if (error instanceof BusinessError) return NextResponse.json({ message: error.message, details: error.details }, { status: error.status, headers });
    console.error("Une opération de gestion a échoué.", error instanceof Error ? error.name : "Erreur inconnue");
    return NextResponse.json({ message: "L’opération n’a pas pu être enregistrée. Veuillez réessayer." }, { status: 500, headers });
  }
}
