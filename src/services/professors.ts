import "server-only";
import { db } from "@/server/db";
import { activationSchema, createProfessorSchema, professorFields, uuidSchema } from "@/validations/management";
import { audit, missingRecord, type Actor } from "@/services/management-shared";
import { financialLedger } from "@/services/financial-read";
import { agreementRow } from "@/services/pricing";
import { sessionRelations, sessionRow } from "@/services/sessions";
import { findApplicableAgreement } from "@/lib/management-rules";
import { tunisDate } from "@/lib/dates";
import { money } from "@/lib/money";
import type { MonthlyActivity, ProfessorDetails, ProfessorRow } from "@/types/management";
import { readAgendaEvents } from "@/services/agenda-read";
import { addDays } from "@/lib/scheduling";

export async function listProfessors(): Promise<ProfessorRow[]> {
  const teachers = await db.teacher.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: {
    agreements: { orderBy: { startDate: "desc" } }, _count: { select: { sessions: { where: { status: "TERMINEE" } } } },
  } });
  const ledger = await financialLedger();
  const date = tunisDate().format("YYYY-MM-DD");
  return teachers.map(teacher => ({
    id: teacher.id, firstName: teacher.firstName, lastName: teacher.lastName, fullName: `${teacher.firstName} ${teacher.lastName}`,
    phone: teacher.phone, email: teacher.email, address: teacher.address, notes: teacher.notes, active: teacher.active,
    createdAt: teacher.createdAt.toISOString(), currentPrice: findApplicableAgreement(teacher.agreements.map(agreementRow), date)?.pricePerSession ?? null,
    completedSessions: teacher._count.sessions, finance: ledger.summary(teacher.id),
  }));
}

export async function professorDetails(id: string): Promise<ProfessorDetails> {
  uuidSchema.parse(id);
  const teachers = await listProfessors();
  const teacher = teachers.find(value => value.id === id);
  if (!teacher) missingRecord("Professeur");
  const agreements = await db.professorRateAgreement.findMany({ where: { teacherId: id }, orderBy: { startDate: "desc" } });
  const sessions = await db.teachingSession.findMany({ where: { teacherId: id }, include: sessionRelations, orderBy: { startAt: "desc" }, take: 100 });
  const totalSessions = await db.teachingSession.count({ where: { teacherId: id } });
  const today = tunisDate().format("YYYY-MM-DD");
  const upcoming = (await readAgendaEvents(db, today, addDays(today, 90))).filter(event => event.teacherId === id && !event.persisted);
  const profileSessions = [...sessions.map(sessionRow), ...upcoming].sort((a, b) => b.startAt.localeCompare(a.startAt));
  const ledger = await financialLedger(id);
  const completed = await db.teachingSession.findMany({ where: { teacherId: id, status: "TERMINEE" }, select: { completedAt: true } });
  const monthMap = new Map<string, MonthlyActivity>();
  const getMonth = (month: string) => {
    const item = monthMap.get(month) ?? { month, completedSessions: 0, due: null, received: null };
    monthMap.set(month, item); return item;
  };
  for (const session of completed) if (session.completedAt) getMonth(tunisDate(session.completedAt).format("YYYY-MM")).completedSessions++;
  for (const charge of ledger.charges) {
    const month = getMonth(tunisDate(charge.chargedAt).format("YYYY-MM"));
    month.due = money(month.due ?? "0").plus(charge.amount).toFixed(3);
  }
  for (const payment of ledger.receipts) {
    const month = getMonth(payment.paymentDate.toISOString().slice(0, 7));
    month.received = money(month.received ?? "0").plus(payment.amount).toFixed(3);
  }
  return { ...teacher, agreements: agreements.map(agreementRow), sessions: profileSessions, totalSessions,
    charges: ledger.chargeRows, payments: ledger.paymentRows, monthlyActivity: [...monthMap.values()].sort((a, b) => b.month.localeCompare(a.month)) };
}

export async function createProfessor(input: unknown, actor: Actor) {
  const data = createProfessorSchema.parse(input);
  return db.$transaction(async tx => {
    const teacher = await tx.teacher.create({ data });
    await audit(tx, actor, "CREATION_PROFESSEUR", "Teacher", teacher.id, undefined, data);
    return { id: teacher.id };
  });
}

export async function updateProfessor(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const data = professorFields.parse(input);
  return db.$transaction(async tx => {
    const teacher = await tx.teacher.findUnique({ where: { id } });
    if (!teacher) missingRecord("Professeur");
    await tx.teacher.update({ where: { id }, data });
    await audit(tx, actor, "MODIFICATION_PROFESSEUR", "Teacher", id,
      { firstName: teacher.firstName, lastName: teacher.lastName, phone: teacher.phone, email: teacher.email, address: teacher.address, notes: teacher.notes }, data);
    return { id };
  });
}

export async function setProfessorActive(id: string, input: unknown, actor: Actor) {
  uuidSchema.parse(id);
  const { active } = activationSchema.parse(input);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(736204)::text`;
    await tx.$queryRaw`SELECT id FROM "Teacher" WHERE id=${id}::uuid FOR UPDATE`;
    const teacher = await tx.teacher.findUnique({ where: { id } });
    if (!teacher) missingRecord("Professeur");
    if (teacher.active !== active) {
      await tx.teacher.update({ where: { id }, data: { active } });
      await audit(tx, actor, active ? "ACTIVATION_PROFESSEUR" : "DESACTIVATION_PROFESSEUR", "Teacher", id, { active: teacher.active }, { active });
    }
    return { id, active };
  });
}
