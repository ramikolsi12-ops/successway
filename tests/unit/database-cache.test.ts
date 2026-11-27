import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => {
  const created = vi.fn();
  class Client {
    $disconnect = vi.fn(async () => {});
    constructor() { created(); }
  }
  return { Client, created };
});

vi.mock("@/generated/prisma/client", () => ({ PrismaClient: clients.Client }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));

const cache = globalThis as typeof globalThis & {
  database?: { $disconnect: () => Promise<void> };
  databaseConstructor?: unknown;
  databaseUrl?: string;
  databaseAdapterVersion?: string;
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("@/generated/prisma/client", () => ({ PrismaClient: clients.Client }));
  delete cache.database;
  delete cache.databaseConstructor;
  delete cache.databaseUrl;
  delete cache.databaseAdapterVersion;
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:5435/cache_test");
});

afterEach(async () => {
  await cache.database?.$disconnect();
  delete cache.database;
  delete cache.databaseConstructor;
  delete cache.databaseUrl;
  delete cache.databaseAdapterVersion;
  vi.unstubAllEnvs();
});

describe("Client PostgreSQL pendant Fast Refresh", () => {
  it("remplace un ancien client conservé avant la correction du cache", async () => {
    const old = { $disconnect: vi.fn(async () => {}) };
    cache.database = old;
    const { db } = await import("@/server/db");
    expect(db).not.toBe(old);
    expect(old.$disconnect).toHaveBeenCalledOnce();
  });

  it("réutilise la connexion si le client généré et la base sont identiques", async () => {
    const { db: first } = await import("@/server/db");
    vi.resetModules();
    const { db: second } = await import("@/server/db");
    expect(second).toBe(first);
    expect(clients.created).toHaveBeenCalledOnce();
    expect(first.$disconnect).not.toHaveBeenCalled();
  });

  it("remplace une connexion antérieure à la sérialisation même si le client et la base sont identiques", async () => {
    const old = { $disconnect: vi.fn(async () => {}) };
    cache.database = old;
    cache.databaseConstructor = clients.Client;
    cache.databaseUrl = process.env.DATABASE_URL;
    const { db: first } = await import("@/server/db");
    expect(first).not.toBe(old);
    expect(old.$disconnect).toHaveBeenCalledOnce();
    expect(cache.databaseAdapterVersion).toBe("serialized-pg-v1");
    vi.resetModules();
    const { db: second } = await import("@/server/db");
    expect(second).toBe(first);
    expect(clients.created).toHaveBeenCalledOnce();
    expect(first.$disconnect).not.toHaveBeenCalled();
  });

  it("renouvelle la connexion quand le schéma Prisma est régénéré", async () => {
    const { db: first } = await import("@/server/db");
    class RegeneratedClient extends clients.Client {}
    vi.doMock("@/generated/prisma/client", () => ({ PrismaClient: RegeneratedClient }));
    vi.resetModules();
    const { db: second } = await import("@/server/db");
    expect(second).not.toBe(first);
    expect(first.$disconnect).toHaveBeenCalledOnce();
  });

  it("ne réutilise pas une connexion vers une autre base", async () => {
    const { db: first } = await import("@/server/db");
    vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:5435/another_test");
    vi.resetModules();
    const { db: second } = await import("@/server/db");
    expect(second).not.toBe(first);
    expect(first.$disconnect).toHaveBeenCalledOnce();
  });
});
