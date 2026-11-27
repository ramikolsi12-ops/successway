import { db } from "@/server/db";

const windowMs = 15 * 60 * 1000;
const maxAttempts = 5;
const globalKey = ":global-auth";
const globalWindowMs = 60 * 1000;
const globalMaximum = 30;

/** Reserve before expensive verification, including simultaneous attempts. */
export async function reserveAuthenticationAttempt(identifier: string) {
  return db.$transaction(async tx => {
    const now = new Date();
    // This bucket is independent of attacker-chosen identifiers. Keep the lock
    // order global -> account for every authentication/password verification.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${globalKey}, 0))`;
    const global = await tx.loginAttempt.findUnique({ where: { identifier: globalKey } });
    const globalWithinWindow = global && now.getTime() - global.windowStart.getTime() < globalWindowMs;
    if (globalWithinWindow && global.failures >= globalMaximum) return false;
    await tx.loginAttempt.upsert({ where: { identifier: globalKey },
      create: { identifier: globalKey, failures: 1, windowStart: now },
      update: { failures: globalWithinWindow ? global.failures + 1 : 1, windowStart: globalWithinWindow ? global.windowStart : now, blockedUntil: null },
    });
    if (!globalWithinWindow) await tx.loginAttempt.deleteMany({ where: {
      identifier: { not: globalKey }, updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }],
    } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identifier}, 0))`;
    const previous = await tx.loginAttempt.findUnique({ where: { identifier } });
    if (previous?.blockedUntil && previous.blockedUntil > now) return false;
    const withinWindow = previous && now.getTime() - previous.windowStart.getTime() < windowMs;
    const failures = withinWindow ? previous.failures + 1 : 1;
    await tx.loginAttempt.upsert({
      where: { identifier }, create: { identifier, failures: 1, windowStart: now },
      update: { failures, windowStart: withinWindow ? previous.windowStart : now,
        blockedUntil: failures >= maxAttempts ? new Date(now.getTime() + windowMs) : null },
    });
    return true;
  });
}
