import { describe, expect, it, vi } from "vitest";

const callbacks = vi.hoisted(() => [] as ((error: Error | null, key: Buffer) => void)[]);
vi.mock("node:crypto", async importOriginal => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  scrypt: (_password: string, _salt: string, _length: number, _options: unknown, callback: typeof callbacks[number]) => { callbacks.push(callback); },
}));
import { verifyPassword } from "@/lib/password";

describe("Capacité du hachage des mots de passe", () => {
  it("limite les dérivations simultanées et libère la capacité après réussite ou erreur", async () => {
    const first = verifyPassword("exemple", null), second = verifyPassword("exemple", null);
    await expect(verifyPassword("exemple", null)).rejects.toMatchObject({ status: 503 });
    expect(callbacks).toHaveLength(2);
    callbacks[0](null, Buffer.alloc(64)); await expect(first).resolves.toBe(false);
    const third = verifyPassword("exemple", null);
    expect(callbacks).toHaveLength(3);
    callbacks[1](new Error("Dérivation interrompue"), Buffer.alloc(64)); await expect(second).rejects.toThrow("interrompue");
    callbacks[2](null, Buffer.alloc(64)); await expect(third).resolves.toBe(false);
    const last = verifyPassword("exemple", null);
    callbacks[3](null, Buffer.alloc(64)); await expect(last).resolves.toBe(false);
  });
});
