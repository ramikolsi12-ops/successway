import type { SessionRow, SessionStatus } from "@/types/management";
import type { FinancialCharge, PricingSource } from "@/types/payments";
import type { RateAgreementRow } from "@/types/management";
import type { OpeningHours } from "@/lib/opening-hours";

export type SessionType = "FIXE" | "PROVISOIRE";
export interface AgendaEvent extends SessionRow {
  sessionId: string | null;
  type: SessionType;
  recurrenceId: string | null;
  occurrenceWeek: string | null;
  originalDate: string | null;
  isException: boolean;
  startedAt: string | null;
  completedAt: string | null;
  absentAt: string | null;
  cancelledAt: string | null;
  applicableRate: string | null;
  defaultRate: string | null;
  priceOverride: string | null;
  pricingSource: PricingSource;
  expectedPrice: string | null;
  financial: FinancialCharge | null;
  chargeAmount: string | null;
  persisted: boolean;
  recurrence: AgendaRecurrence | null;
}
export interface AgendaRecurrence {
  id: string;
  teacherId: string;
  classroomId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  startDate: string;
  endDate: string | null;
  notes: string | null;
}
export interface AgendaRoom { id: string; name: string; active: boolean }
export interface AgendaProfessor { id: string; name: string; active: boolean; agreements: RateAgreementRow[] }
export interface AgendaData {
  date: string;
  openingHours: OpeningHours;
  events: AgendaEvent[];
  classrooms: AgendaRoom[];
  professors: AgendaProfessor[];
}
export interface SessionInput {
  teacherId: string;
  classroomId: string;
  date: string;
  startTime: string;
  endTime: string;
  type: SessionType;
  notes: string | null;
  recurrenceStartDate?: string;
  recurrenceEndDate?: string | null;
  weekday?: number;
  priceOverride?: string | null;
  overrideDecision?: "KEEP" | "RESTORE";
}
export interface RecurrenceUpdateInput {
  teacherId: string;
  classroomId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  effectiveDate: string;
  endDate: string | null;
  notes: string | null;
  confirm: boolean;
}
export interface SessionStatusInput { status: SessionStatus; confirm: boolean; priceOverride?: string | null; idempotencyKey?: string; expectedPrice?: string }
