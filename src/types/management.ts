export type SessionStatus = "PLANIFIEE" | "EN_COURS" | "TERMINEE" | "ABSENT" | "ANNULEE";
export type Availability = "DISPONIBLE" | "OCCUPEE" | "INACTIVE";

export interface SessionRow {
  id: string;
  teacherId: string;
  teacherName: string;
  classroomId: string;
  classroomName: string;
  startAt: string;
  endAt: string;
  status: SessionStatus;
  notes: string | null;
  rateSnapshot: string | null;
}

export interface ClassroomRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  availability: Availability;
  futurePlannedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomData {
  rooms: ClassroomRow[];
  startAt: string;
  endAt: string;
}

export interface ClassroomDetails extends ClassroomRow {
  sessions: SessionRow[];
  totalSessions: number;
}

export interface RateAgreementRow {
  id: string;
  pricePerSession: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
}

export interface FinanceSummary {
  hasEntries: boolean;
  totalDue: string;
  totalReceived: string;
  remaining: string;
  unpaidSessions: number;
  partiallyPaidSessions: number;
  paidSessions: number;
  lastPaymentDate: string | null;
}

export interface ProfessorRow {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  currentPrice: string | null;
  completedSessions: number;
  finance: FinanceSummary;
}

export interface ChargeRow {
  id: string;
  sessionId: string;
  sessionDate: string;
  amount: string;
  paid: string;
  remaining: string;
  status: "PAYEE" | "PARTIELLE" | "NON_PAYEE";
}

export interface PaymentRow {
  id: string;
  teacherId: string;
  teacherName: string;
  paymentDate: string;
  amount: string;
  notes: string | null;
  allocated: string;
}

export interface MonthlyActivity {
  month: string;
  completedSessions: number;
  due: string | null;
  received: string | null;
}

export interface ProfessorDetails extends ProfessorRow {
  agreements: RateAgreementRow[];
  sessions: SessionRow[];
  totalSessions: number;
  charges: ChargeRow[];
  payments: PaymentRow[];
  monthlyActivity: MonthlyActivity[];
}

export interface SessionFilters {
  startAt: string;
  endAt: string;
  teacherId?: string;
  classroomId?: string;
  status?: SessionStatus;
  page: number;
  pageSize: number;
}

export interface SessionPage {
  sessions: SessionRow[];
  total: number;
  filters: SessionFilters;
}
