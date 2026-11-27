import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createDatabasePool } from "@/server/pg-pool";
import { databaseUrl } from "@/server/environment";

export function createDatabaseClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL est manquante. Exécutez scripts/Initialize-Local.ps1.");
  return new PrismaClient({
    adapter: new PrismaPg(createDatabasePool(databaseUrl(connectionString)), { disposeExternalPool: true }),
    log: ["error"],
  });
}

const globalDatabase = globalThis as unknown as {
  database?: PrismaClient;
  databaseConstructor?: typeof PrismaClient;
  databaseUrl?: string;
  databaseAdapterVersion?: string;
};
const databaseAdapterVersion = "serialized-pg-v1";
const developmentCache = process.env.NODE_ENV !== "production";
// Regenerating Prisma creates a new constructor. Reusing an older instance would
// keep its old column definitions after a schema migration and Fast Refresh.
// The adapter stamp also replaces pools created before query serialization.
const cachedDatabase = developmentCache
  && globalDatabase.databaseConstructor === PrismaClient
  && globalDatabase.databaseUrl === process.env.DATABASE_URL
  && globalDatabase.databaseAdapterVersion === databaseAdapterVersion
  ? globalDatabase.database
  : undefined;

if (developmentCache && globalDatabase.database && !cachedDatabase) {
  void globalDatabase.database.$disconnect().catch(() => {
    console.error("L’ancienne connexion PostgreSQL n’a pas pu être libérée.");
  });
}

export const db = cachedDatabase ?? createDatabaseClient();
if (developmentCache) {
  globalDatabase.database = db;
  globalDatabase.databaseConstructor = PrismaClient;
  globalDatabase.databaseUrl = process.env.DATABASE_URL;
  globalDatabase.databaseAdapterVersion = databaseAdapterVersion;
}
