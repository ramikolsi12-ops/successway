import NextAuth from "next-auth";
import { authOptions } from "@/server/auth-options";
import { NextRequest, NextResponse } from "next/server";
import { readRequestBytes } from "@/server/request-body";
import { BusinessError } from "@/lib/business-error";

type Context = { params: Promise<{ nextauth: string[] }> };
const handler = NextAuth(authOptions) as (request: NextRequest, context: Context) => Promise<Response>;
export const GET = handler;

export async function POST(request: NextRequest, context: Context) {
  try {
    const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type !== "application/json" && type !== "application/x-www-form-urlencoded") throw new BusinessError("Le format de la requête de connexion est invalide.", 415);
    const body = await readRequestBytes(request, 16 * 1024);
    try {
      const value = new TextDecoder("utf-8", { fatal: true }).decode(body);
      if (type === "application/json") JSON.parse(value);
    } catch { throw new BusinessError("Le contenu de la requête de connexion est invalide."); }
    // NextAuth retains its own CSRF token and credentials checks after the limit.
    return await handler(new NextRequest(request.url, { method: "POST", headers: request.headers, body }), context);
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error("La connexion a échoué.", error instanceof Error ? error.name : "Erreur inconnue");
    return NextResponse.json({ message: error instanceof BusinessError ? error.message : "Le service de connexion est temporairement indisponible." },
      { status: error instanceof BusinessError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
export const runtime = "nodejs";
