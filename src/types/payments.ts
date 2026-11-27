import type { FinanceSummary, ProfessorRow } from "@/types/management";

export type PricingSource = "HABITUEL" | "EXCEPTIONNEL";
export type FinancialStatus = "PAYEE" | "PARTIELLE" | "NON_PAYEE" | "NON_APPLICABLE";
export interface AllocationDetail {
  id: string; paymentId: string; chargeId: string; amount: string;
  paymentDate: string; paymentAmount: string;
  sessionDate: string; sessionStartAt: string; sessionEndAt: string; sessionPrice: string;
  classroomName: string; valid: boolean; voidReason: string | null; createdAt: string;
}
export interface FinancialCharge {
  id: string; sessionId: string; agendaId: string; teacherId: string;
  sessionDate: string; startAt: string; endAt: string; classroomName: string;
  type: "FIXE" | "PROVISOIRE"; amount: string; pricingSource: PricingSource;
  paid: string; remaining: string; status: FinancialStatus; settledDate: string | null;
  allocations: AllocationDetail[];
  history: FinancialAudit[];
}
export interface FinancialAudit {
  id: string; action: string; reason: string | null; createdAt: string;
  before: unknown; after: unknown;
}
export interface FinancialPayment {
  id: string; teacherId: string; teacherName: string; amount: string; paymentDate: string;
  notes: string | null;
  createdAt: string; recordedBy: string | null; valid: boolean;
  voidedAt: string | null; voidReason: string | null; replacesId: string | null;
  replacementId: string | null; allocated: string;
  allocations: AllocationDetail[]; history: FinancialAudit[];
}
export interface ProfessorFinance {
  professor: ProfessorRow; summary: FinanceSummary;
  charges: FinancialCharge[]; payments: FinancialPayment[];
  completedSessions: number; sessionsToSettle: number; integrityIssues: string[];
}
export interface PaymentOverview {
  integrityIssues: string[];
  professors: ProfessorRow[]; payments: FinancialPayment[];
  totals: { totalDue: string; totalReceived: string; remaining: string;
    unpaidSessions: number; partiallyPaidSessions: number; paidSessions: number;
    sessionsToSettle: number; professorsWithDebt: number };
}
export interface PaymentInput {
  teacherId: string; amount: string; paymentDate: string; notes?: string | null;
}
export interface AllocationPreviewRow {
  chargeId: string; sessionDate: string; startAt: string; amount: string;
  previouslyPaid: string; allocated: string; remaining: string; status: FinancialStatus;
}
export interface PaymentPreview {
  token: string; teacherId: string; before: FinanceSummary; after: FinanceSummary;
  additionalPaidSessions: number; sessionsToSettle: number; allocations: AllocationPreviewRow[];
}
export interface PaymentCommand extends PaymentInput {
  previewToken: string; idempotencyKey: string; confirm: boolean;
}
export interface PaymentCorrectionInput {
  amount: string; paymentDate: string; notes?: string | null; reason: string; previewToken?: string; idempotencyKey: string; confirm: boolean;
}
export interface CorrectionPreview extends PaymentPreview { targetId: string; kind: "PAYMENT" | "PRICE" | "CANCELLATION" }
