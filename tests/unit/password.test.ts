import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("Mots de passe administrateur", () => {
  it("utilise un sel aléatoire et vérifie sans conserver le mot de passe", async () => {
    const password = "Un-mot-de-passe-assez-long!";
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("incorrect", first)).toBe(false);
  });
  it("refuse un mot de passe court", async () => { await expect(hashPassword("court")).rejects.toThrow("12"); });
  it("refuse un hash absent ou corrompu", async () => {
    expect(await verifyPassword("exemple", null)).toBe(false);
    expect(await verifyPassword("exemple", "scrypt$999999999$8$1$x$y")).toBe(false);
  });
});
