import { getCentreLogo } from "@/services/settings";

/** Only the normalized centre image is public, so it can appear on the login page. */
export async function GET() {
  try {
    const logo = await getCentreLogo();
    if (!logo) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.mime, "Content-Length": String(logo.bytes.length),
      "Cache-Control": "no-cache", ETag: `"${logo.hash}"`, "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="logo-centre.webp"', "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch {
    console.error("Le logo du centre n’a pas pu être chargé.");
    return Response.json({ message: "Le logo du centre n’a pas pu être chargé." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
