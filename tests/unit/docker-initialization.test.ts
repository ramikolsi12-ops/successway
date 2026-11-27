import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { executeExistingSeed, initializeAdministrator, readHiddenSecret, readSecretFromStdin } from "../../scripts/docker/init-admin.mjs";

const connection = "postgresql://test:unused@127.0.0.1:5435/centre_formation_test";
function output() {
  let text = "";
  const stream = new Writable({ write(chunk, _encoding, done) { text += chunk.toString(); done(); } });
  return { stream, text: () => text };
}

beforeEach(() => vi.clearAllMocks());

describe("Initialisation Docker sans secret dans la commande", () => {
  it("refuse une cible absente ou invalide avant toute demande de mot de passe", async () => {
    const readPassword = vi.fn();
    await expect(initializeAdministrator({ environment: {}, readPassword })).rejects.toThrow(/DATABASE_URL/);
    await expect(initializeAdministrator({ environment: { DATABASE_URL: "https://centre.example" }, readPassword })).rejects.toThrow(/PostgreSQL/);
    expect(readPassword).not.toHaveBeenCalled();
  });

  it("ne lit aucun secret et ne relance pas le seed lorsqu’un administrateur existe", async () => {
    const readPassword = vi.fn(), runSeed = vi.fn();
    const printed = output();
    await expect(initializeAdministrator({ environment: { DATABASE_URL: connection, SEED_ADMIN_PASSWORD: "secret-interdit-en-environnement" },
      hasAdministrator: async () => true, readPassword, runSeed, output: printed.stream })).resolves.toEqual({ created: false });
    expect(readPassword).not.toHaveBeenCalled(); expect(runSeed).not.toHaveBeenCalled();
    expect(printed.text()).toContain("Aucun compte, mot de passe ni paramètre");
    expect(printed.text()).not.toContain("secret-interdit");
  });

  it("lit un seul secret depuis stdin et délègue au seed existant sans accepter le secret de l’environnement", async () => {
    const runSeed = vi.fn(async () => {});
    const printed = output();
    await expect(initializeAdministrator({ environment: { DATABASE_URL: connection, SEED_ADMIN_PASSWORD: "ancien-secret-inutilisé" }, hasAdministrator: async () => false,
      arguments: ["--stdin"], input: Readable.from(["Mot-de-passe-isole-2026!\n"]), output: printed.stream, runSeed })).resolves.toEqual({ created: true });
    expect(runSeed).toHaveBeenCalledWith("Mot-de-passe-isole-2026!", { DATABASE_URL: connection });
    expect(printed.text()).not.toContain("Mot-de-passe-isole");
  });

  it.each(["court", "deux-lignes-secretes\nconfirmation-inattendue", "secret-valide-avec\0octet", "x".repeat(257)])("refuse un secret invalide sans appeler le seed %#", async secret => {
    const runSeed = vi.fn();
    await expect(initializeAdministrator({ environment: { DATABASE_URL: connection }, hasAdministrator: async () => false, input: Readable.from([secret]), runSeed })).rejects.toThrow(/12 et 256/);
    expect(runSeed).not.toHaveBeenCalled();
  });

  it("borne stdin et refuse un flux qui n’est pas UTF-8", async () => {
    await expect(readSecretFromStdin(Readable.from([Buffer.alloc(4097)]))).rejects.toThrow(/12 et 256/);
    await expect(readSecretFromStdin(Readable.from([Buffer.from([255])]))).rejects.toThrow(/12 et 256/);
  });

  it("refuse tout argument contenant un mot de passe avant la connexion", async () => {
    const hasAdministrator = vi.fn();
    await expect(initializeAdministrator({ environment: { DATABASE_URL: connection }, arguments: ["--password=secret"], hasAdministrator })).rejects.toThrow(/Aucun mot de passe/);
    expect(hasAdministrator).not.toHaveBeenCalled();
  });

  it("garde la saisie TTY masquée et restaure son mode après validation ou interruption", async () => {
    const printed = output();
    const input = new PassThrough() as PassThrough & { isRaw: boolean; setRawMode: ReturnType<typeof vi.fn> };
    input.isRaw = false; input.setRawMode = vi.fn();
    const secret = readHiddenSecret(input as unknown as NodeJS.ReadStream, printed.stream as unknown as NodeJS.WriteStream, "Mot de passe : ");
    input.emit("keypress", "secret-masque-2026!", { name: "s" });
    input.emit("keypress", "\r", { name: "return" });
    expect(await secret).toBe("secret-masque-2026!");
    expect(printed.text()).not.toContain("secret-masque");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    const interrupted = readHiddenSecret(input as unknown as NodeJS.ReadStream, printed.stream as unknown as NodeJS.WriteStream, "Confirmation : ");
    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await expect(interrupted).rejects.toThrow(/interrompue/);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("invoque uniquement le seed existant sans shell et sans secret dans ses arguments", async () => {
    let invocation: { executable: string; args: string[]; options: { shell: boolean; env: NodeJS.ProcessEnv } } | undefined;
    mocks.spawn.mockImplementation((executable, args, options) => {
      invocation = { executable, args, options: { ...options, env: { ...options.env } } };
      const child = new EventEmitter(); queueMicrotask(() => child.emit("exit", 0)); return child;
    });
    await executeExistingSeed("secret-test-enfant-2026!", { DATABASE_URL: connection });
    expect(invocation?.args).toEqual(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
    expect(invocation?.options.shell).toBe(false);
    expect(invocation?.options.env.SEED_ADMIN_PASSWORD).toBe("secret-test-enfant-2026!");
    expect(invocation?.args.join(" ")).not.toContain("secret-test");
    expect(process.env.SEED_ADMIN_PASSWORD).toBeUndefined();
  });
});
