import "server-only";
import { db } from "@/server/db";
import { requireAdministrator } from "@/server/authorization";
import { tunisDate } from "@/lib/dates";
import { money } from "@/lib/money";
import { summarizeFinance } from "@/lib/finance";
import { dashboardMonth, monthlyActivity } from "@/lib/dashboard";
import { readMonthlyFinancialOverview } from "@/services/financial-read";
import { readAgendaEvents } from "@/services/agenda-read";
import { getCentreBranding } from "@/services/settings";
import type { FinanceSummary, ProfessorRow } from "@/types/management";

export async function getDashboard(month?: string, now = new Date()) {
  const admin = await requireAdministrator();
  const local = tunisDate(now), today = local.format("YYYY-MM-DD");
  const period = dashboardMonth(month, now);
  const branding = await getCentreBranding();
  return db.$transaction(async tx => {
    const [expanded, professors, overview] = await Promise.all([
      readAgendaEvents(tx, period.startDate, period.endDate),
      tx.teacher.findMany({ include: { agreements: { where: { active: true }, select: { pricePerSession: true, startDate: true, endDate: true } } } }),
      readMonthlyFinancialOverview(tx, period.startDate, period.endDate),
    ]);
    // Legacy overnight reservations belong to the month of their local start.
    const events = expanded.filter(event => {
      const date = tunisDate(event.startAt).format("YYYY-MM-DD");
      return date >= period.startDate && date <= period.endDate;
    });
    const empty = summarizeFinance([], [], []);
    const debtProfessors: (ProfessorRow & { monthFinance: FinanceSummary })[] = professors.flatMap(professor => {
      const monthFinance = overview.summaries.get(professor.id) ?? empty;
      if (!money(monthFinance.remaining).gt(0)) return [];
      // PaymentForm must still show the complete balance and allocate global FIFO.
      const finance = overview.globalSummaries.get(professor.id) ?? empty;
      const agreement = professor.agreements.find(rate => rate.startDate.toISOString().slice(0, 10) <= today
        && (!rate.endDate || rate.endDate.toISOString().slice(0, 10) >= today));
      return [{ id: professor.id, firstName: professor.firstName, lastName: professor.lastName,
        fullName: `${professor.firstName} ${professor.lastName}`, phone: professor.phone, email: professor.email,
        address: professor.address, notes: professor.notes, active: professor.active, createdAt: professor.createdAt.toISOString(),
        currentPrice: agreement?.pricePerSession.toFixed(3) ?? null,
        completedSessions: overview.completedCounts.get(professor.id) ?? 0, finance, monthFinance }];
    }).sort((a, b) => money(b.monthFinance.remaining).comparedTo(money(a.monthFinance.remaining)) || a.fullName.localeCompare(b.fullName, "fr"));
    return { centreName: branding.name, displayName: admin.displayName,
      ...period, ...monthlyActivity(events),
      finance: overview.totals, cashReceived: overview.cashReceived, integrityIssues: overview.issues,
      debtProfessors: debtProfessors.slice(0, 5),
      sessions: events.map(session => ({ id: session.id,
        date: tunisDate(session.startAt).format("YYYY-MM-DD"),
        time: `${tunisDate(session.startAt).format("HH:mm")}–${tunisDate(session.endAt).format("YYYY-MM-DD") !== tunisDate(session.startAt).format("YYYY-MM-DD") ? "24:00" : tunisDate(session.endAt).format("HH:mm")}`,
        teacher: session.teacherName, classroom: session.classroomName, type: session.type, status: session.status })),
    };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
