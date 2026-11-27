import { db } from "@/server/db";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const ready = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('statement_timeout','3000',true)`;
      const state = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT current_setting('TimeZone')='Africa/Tunis'
          AND EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(ARRAY['public."AdminUser"','public."Teacher"','public."Classroom"','public."RecurrenceSeries"',
              'public."RecurrenceSchedule"','public."TeachingSession"','public."ProfessorRateAgreement"','public."SessionCharge"',
              'public."ProfessorPayment"','public."PaymentAllocation"','public."AppSetting"','public."AuditLog"','public."LoginAttempt"']) AS tables(name)
            WHERE to_regclass(name) IS NULL
          ) AS ready`;
      return state[0]?.ready === true;
    }, { timeout: 5000, maxWait: 3000 });
    if (ready) return Response.json({ status: "ok" }, { headers });
  } catch { /* Health checks expose neither connection details nor database errors. */ }
  return Response.json({ status: "indisponible", message: "Le service est temporairement indisponible." }, { status: 503, headers });
}
