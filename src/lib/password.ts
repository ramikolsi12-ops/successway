import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { BusinessError } from "@/lib/business-error";
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const keyLength = 64;
let activeDerivations = 0;

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  // Bound memory and worker occupancy; reject instead of retaining an unbounded queue.
  if (activeDerivations >= 2) throw new BusinessError("Le service de connexion est occupé. Veuillez réessayer.", 503);
  activeDerivations++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(password, salt, keyLength, options, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  } finally { activeDerivations--; }
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Le mot de passe doit contenir entre 12 et 256 caractères.");
  }
  const salt = randomBytes(32).toString("hex");
  const key = await deriveKey(password, salt);
  return `scrypt$${options.N}$${options.r}$${options.p}$${salt}$${key.toString("hex")}`;
}

// A missing identifier still incurs the same expensive password derivation.
const dummySalt = "0".repeat(64);
const dummyHash = `scrypt$131072$8$1$${dummySalt}$${"0".repeat(128)}`;

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = (encoded ?? dummyHash).split("$");
  const valid = parts.length === 6 && parts[0] === "scrypt" && parts[1] === "131072" && parts[2] === "8" && parts[3] === "1" && /^[a-f0-9]{64}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const salt = valid ? parts[4] : dummySalt;
  const expected = Buffer.from(valid ? parts[5] : "0".repeat(128), "hex");
  const actual = await deriveKey(password.slice(0, 256), salt);
  return timingSafeEqual(expected, actual) && valid && encoded !== null && password.length <= 256;
}
