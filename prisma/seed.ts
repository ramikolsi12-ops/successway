import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { identifierSchema } from "../src/validations/auth";
import { initializeClassrooms } from "./classroom-bootstrap";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL est manquante.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seed() {
  const referenceOnly = process.argv.includes("--reference-only");
  const identifier = identifierSchema.parse(process.env.ADMIN_IDENTIFIER ?? "administrateur");
  const existingAdminCount = await db.adminUser.count();
  let passwordHash: string | undefined;
  if (!referenceOnly && existingAdminCount === 0) {
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error("Créez votre administrateur avec scripts/Initialize-Local.ps1 (saisie masquée du mot de passe).");
    passwordHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD);
  }
  await db.$transaction(async tx => {
    // Serialize setup, preventing two CLI invocations from creating two initial accounts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73814421)`;
    await initializeClassrooms(tx);
    await tx.appSetting.upsert({ where: { key: "centre" }, update: {}, create: { key: "centre", value: {
      name: "Centre Formation Manager", country: "TN", currency: "TND", currencyLabel: "DT",
      timezone: "Africa/Tunis", locale: "fr-TN", firstDayOfWeek: 1,
    } } });
    await tx.appSetting.upsert({ where: { key: "operatingHours" }, update: {}, create: { key: "operatingHours", value: {
      configured: false, note: "À configurer avant tout calcul de taux d’occupation.",
    } } });
    if (passwordHash && await tx.adminUser.count() === 0) {
      const admin = await tx.adminUser.create({ data: { identifier, passwordHash } });
      await tx.auditLog.create({ data: {
        adminId: admin.id, action: "INITIALISATION_ADMIN", entityType: "AdminUser", entityId: admin.id,
        after: { identifier },
      } });
      console.log(`Compte administrateur créé : ${identifier}`);
    }
  });
  console.log("Initialisation terminée : salles et paramètres de référence. Les données existantes sont conservées.");
}

seed().catch(() => {
  console.error("Échec de l’initialisation. Vérifiez la connexion, les migrations et la saisie du mot de passe (12 à 256 caractères).");
  process.exitCode = 1;
}).finally(async () => { await db.$disconnect(); });
