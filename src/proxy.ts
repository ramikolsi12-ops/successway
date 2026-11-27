import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { authenticationEnvironment } from "@/server/environment";
import { contentSecurityPolicy } from "@/server/security-policy";

export async function proxy(request: NextRequest) {
  const environment = authenticationEnvironment();
  const development = process.env.NODE_ENV !== "production";
  const nonce = development ? null : Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce ?? "", development, request.url);
  const requestHeaders = new Headers(request.headers);
  // Overwrite incoming values: callers cannot choose the nonce used by Next.js.
  requestHeaders.delete("x-nonce");
  if (nonce) requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const path = request.nextUrl.pathname;
  let response: NextResponse;
  if (path === "/connexion" || path.startsWith("/api/auth/") || path === "/api/centre/logo") response = next();
  else {
    const token = await getToken({ req: request, secret: environment.secret, secureCookie: environment.secureCookies });
    response = token ? next() : path.startsWith("/api/")
      ? NextResponse.json({ message: "Authentification requise." }, { status: 401 })
      : NextResponse.redirect(new URL("/connexion", request.url));
  }
  response.headers.set("Content-Security-Policy", policy);
  if (path !== "/api/centre/logo") response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/|favicon.ico|icon.svg).*)"] };
