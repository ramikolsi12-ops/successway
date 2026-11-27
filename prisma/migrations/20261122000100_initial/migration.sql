-- Initial schema. Additional PostgreSQL invariants are in the next migration.

CREATE TYPE "SessionStatus" AS ENUM ('PLANIFIEE', 'TERMINEE', 'ANNULEE');

CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSE');

CREATE TYPE "PaymentMethod" AS ENUM ('ESPECES', 'VIREMENT', 'CHEQUE', 'AUTRE');

CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "identifier" VARCHAR(100) NOT NULL,
    "displayName" VARCHAR(150) NOT NULL DEFAULT 'Administrateur',
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoginAttempt" (
    "identifier" VARCHAR(100) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("identifier")
);

CREATE TABLE "Teacher" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "email" VARCHAR(254),
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registrationDate" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherSubject" (
    "teacherId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherSubject_pkey" PRIMARY KEY ("teacherId", "subjectId")
);

CREATE TABLE "EducationLevel" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EducationLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherContract" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "subjectId" UUID,
    "groupId" UUID,
    "amountPerSession" DECIMAL(14, 3) NOT NULL,
    "expectedDurationMinutes" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TeacherContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(30),
    "guardianName" VARCHAR(200),
    "guardianPhone" VARCHAR(30),
    "educationLevelId" UUID NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registrationDate" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Group" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "educationLevelId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentGroup" (
    "id" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Classroom" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 20,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Classroom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurrenceSeries" (
    "id" UUID NOT NULL,
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Tunis',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "RecurrenceSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeachingSession" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "classroomId" UUID NOT NULL,
    "recurrenceId" UUID,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANIFIEE',
    "notes" TEXT,
    "contractId" UUID,
    "rateSnapshot" DECIMAL(14, 3),
    "rateOverrideReason" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TeachingSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherEarning" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "contractId" UUID,
    "amount" DECIMAL(14, 3) NOT NULL,
    "earnedAt" TIMESTAMPTZ(3) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TeacherEarning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeacherPayment" (
    "id" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(14, 3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(200),
    "notes" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TeacherPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "earningId" UUID NOT NULL,
    "amount" DECIMAL(14, 3) NOT NULL,
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "adminId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(100) NOT NULL,
    "entityId" VARCHAR(200) NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppSetting" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "AdminUser_identifier_key" ON "AdminUser"("identifier");

CREATE INDEX "Teacher_active_lastName_firstName_idx" ON "Teacher"("active", "lastName", "firstName");

CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");

CREATE INDEX "TeacherSubject_subjectId_idx" ON "TeacherSubject"("subjectId");

CREATE UNIQUE INDEX "EducationLevel_name_key" ON "EducationLevel"("name");

CREATE INDEX "TeacherContract_teacherId_active_startDate_idx" ON "TeacherContract"("teacherId", "active", "startDate");

CREATE INDEX "TeacherContract_subjectId_idx" ON "TeacherContract"("subjectId");

CREATE INDEX "TeacherContract_groupId_idx" ON "TeacherContract"("groupId");

CREATE INDEX "Student_active_lastName_firstName_idx" ON "Student"("active", "lastName", "firstName");

CREATE INDEX "Student_educationLevelId_idx" ON "Student"("educationLevelId");

CREATE UNIQUE INDEX "Group_name_key" ON "Group"("name");

CREATE INDEX "Group_educationLevelId_idx" ON "Group"("educationLevelId");

CREATE INDEX "Group_subjectId_idx" ON "Group"("subjectId");

CREATE INDEX "Group_teacherId_idx" ON "Group"("teacherId");

CREATE INDEX "StudentGroup_groupId_leftAt_idx" ON "StudentGroup"("groupId", "leftAt");

CREATE INDEX "StudentGroup_studentId_joinedAt_idx" ON "StudentGroup"("studentId", "joinedAt");

CREATE UNIQUE INDEX "Classroom_name_key" ON "Classroom"("name");

CREATE INDEX "TeachingSession_startAt_status_idx" ON "TeachingSession"("startAt", "status");

CREATE INDEX "TeachingSession_completedAt_idx" ON "TeachingSession"("completedAt");

CREATE INDEX "TeachingSession_teacherId_startAt_idx" ON "TeachingSession"("teacherId", "startAt");

CREATE INDEX "TeachingSession_classroomId_startAt_idx" ON "TeachingSession"("classroomId", "startAt");

CREATE INDEX "TeachingSession_groupId_startAt_idx" ON "TeachingSession"("groupId", "startAt");

CREATE INDEX "TeachingSession_subjectId_idx" ON "TeachingSession"("subjectId");

CREATE INDEX "TeachingSession_contractId_idx" ON "TeachingSession"("contractId");

CREATE INDEX "TeachingSession_recurrenceId_idx" ON "TeachingSession"("recurrenceId");

CREATE UNIQUE INDEX "Attendance_sessionId_studentId_key" ON "Attendance"("sessionId", "studentId");

CREATE INDEX "Attendance_studentId_idx" ON "Attendance"("studentId");

CREATE UNIQUE INDEX "TeacherEarning_sessionId_key" ON "TeacherEarning"("sessionId");

CREATE UNIQUE INDEX "TeacherEarning_idempotencyKey_key" ON "TeacherEarning"("idempotencyKey");

CREATE INDEX "TeacherEarning_teacherId_earnedAt_idx" ON "TeacherEarning"("teacherId", "earnedAt");

CREATE INDEX "TeacherEarning_earnedAt_idx" ON "TeacherEarning"("earnedAt");

CREATE INDEX "TeacherEarning_contractId_idx" ON "TeacherEarning"("contractId");

CREATE UNIQUE INDEX "TeacherPayment_idempotencyKey_key" ON "TeacherPayment"("idempotencyKey");

CREATE INDEX "TeacherPayment_teacherId_paymentDate_idx" ON "TeacherPayment"("teacherId", "paymentDate");

CREATE INDEX "TeacherPayment_paymentDate_idx" ON "TeacherPayment"("paymentDate");

CREATE UNIQUE INDEX "PaymentAllocation_idempotencyKey_key" ON "PaymentAllocation"("idempotencyKey");

CREATE INDEX "PaymentAllocation_paymentId_voidedAt_idx" ON "PaymentAllocation"("paymentId", "voidedAt");

CREATE INDEX "PaymentAllocation_earningId_voidedAt_idx" ON "PaymentAllocation"("earningId", "voidedAt");

CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

CREATE INDEX "AuditLog_adminId_createdAt_idx" ON "AuditLog"("adminId", "createdAt");

ALTER TABLE "TeacherSubject" ADD CONSTRAINT "TeacherSubject_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherSubject" ADD CONSTRAINT "TeacherSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Student" ADD CONSTRAINT "Student_educationLevelId_fkey" FOREIGN KEY ("educationLevelId") REFERENCES "EducationLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Group" ADD CONSTRAINT "Group_educationLevelId_fkey" FOREIGN KEY ("educationLevelId") REFERENCES "EducationLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Group" ADD CONSTRAINT "Group_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Group" ADD CONSTRAINT "Group_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "RecurrenceSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "TeacherContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeachingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TeachingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "TeacherContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeacherPayment" ADD CONSTRAINT "TeacherPayment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "TeacherPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "TeacherEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
