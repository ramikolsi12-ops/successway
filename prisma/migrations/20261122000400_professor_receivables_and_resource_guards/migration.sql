-- Business correction: professors pay the centre. All changes preserve rows.
BEGIN;
LOCK TABLE "TeacherContract", "TeacherEarning", "TeacherPayment", "PaymentAllocation" IN ACCESS EXCLUSIVE MODE;

-- Never silently reinterpret an existing outgoing-payment ledger as receipts.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TeacherEarning") OR EXISTS (SELECT 1 FROM "TeacherPayment")
     OR EXISTS (SELECT 1 FROM "PaymentAllocation") OR EXISTS (SELECT 1 FROM "TeacherContract") THEN
    RAISE EXCEPTION 'Des données de l’ancien modèle financier existent. Une décision de reprise explicite est nécessaire avant cette migration.';
  END IF;
END $$;

ALTER TABLE "TeacherContract" RENAME TO "ProfessorRateAgreement";
ALTER TABLE "ProfessorRateAgreement" RENAME COLUMN "amountPerSession" TO "pricePerSession";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_pkey" TO "ProfessorRateAgreement_pkey";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_teacherId_fkey" TO "ProfessorRateAgreement_teacherId_fkey";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_teacher_overlap" TO "ProfessorRateAgreement_teacher_overlap";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_nonnegative_rate" TO "ProfessorRateAgreement_nonnegative_rate";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_duration" TO "ProfessorRateAgreement_duration";
ALTER TABLE "ProfessorRateAgreement" RENAME CONSTRAINT "TeacherContract_dates" TO "ProfessorRateAgreement_dates";
ALTER INDEX "TeacherContract_teacherId_active_startDate_idx" RENAME TO "ProfessorRateAgreement_teacherId_active_startDate_idx";

ALTER TABLE "TeachingSession" RENAME COLUMN "contractId" TO "rateAgreementId";
ALTER TABLE "TeachingSession" RENAME CONSTRAINT "TeachingSession_contractId_fkey" TO "TeachingSession_rateAgreementId_fkey";
ALTER INDEX "TeachingSession_contractId_idx" RENAME TO "TeachingSession_rateAgreementId_idx";

ALTER TABLE "TeacherEarning" RENAME TO "SessionCharge";
ALTER TABLE "SessionCharge" RENAME COLUMN "contractId" TO "rateAgreementId";
ALTER TABLE "SessionCharge" RENAME COLUMN "earnedAt" TO "chargedAt";
ALTER TABLE "SessionCharge" RENAME CONSTRAINT "TeacherEarning_pkey" TO "SessionCharge_pkey";
ALTER TABLE "SessionCharge" RENAME CONSTRAINT "TeacherEarning_teacherId_fkey" TO "SessionCharge_teacherId_fkey";
ALTER TABLE "SessionCharge" RENAME CONSTRAINT "TeacherEarning_sessionId_fkey" TO "SessionCharge_sessionId_fkey";
ALTER TABLE "SessionCharge" RENAME CONSTRAINT "TeacherEarning_contractId_fkey" TO "SessionCharge_rateAgreementId_fkey";
ALTER TABLE "SessionCharge" RENAME CONSTRAINT "TeacherEarning_nonnegative_amount" TO "SessionCharge_nonnegative_amount";
ALTER INDEX "TeacherEarning_sessionId_key" RENAME TO "SessionCharge_sessionId_key";
ALTER INDEX "TeacherEarning_idempotencyKey_key" RENAME TO "SessionCharge_idempotencyKey_key";
ALTER INDEX "TeacherEarning_teacherId_earnedAt_idx" RENAME TO "SessionCharge_teacherId_chargedAt_idx";
ALTER INDEX "TeacherEarning_earnedAt_idx" RENAME TO "SessionCharge_chargedAt_idx";
ALTER INDEX "TeacherEarning_contractId_idx" RENAME TO "SessionCharge_rateAgreementId_idx";
ALTER TRIGGER "TeacherEarning_keep_history" ON "SessionCharge" RENAME TO "SessionCharge_keep_history";

ALTER TABLE "TeacherPayment" RENAME TO "ProfessorPayment";
ALTER TABLE "ProfessorPayment" RENAME CONSTRAINT "TeacherPayment_pkey" TO "ProfessorPayment_pkey";
ALTER TABLE "ProfessorPayment" RENAME CONSTRAINT "TeacherPayment_teacherId_fkey" TO "ProfessorPayment_teacherId_fkey";
ALTER TABLE "ProfessorPayment" RENAME CONSTRAINT "TeacherPayment_positive_amount" TO "ProfessorPayment_positive_amount";
ALTER INDEX "TeacherPayment_idempotencyKey_key" RENAME TO "ProfessorPayment_idempotencyKey_key";
ALTER INDEX "TeacherPayment_teacherId_paymentDate_idx" RENAME TO "ProfessorPayment_teacherId_paymentDate_idx";
ALTER INDEX "TeacherPayment_paymentDate_idx" RENAME TO "ProfessorPayment_paymentDate_idx";
ALTER TRIGGER "TeacherPayment_keep_history" ON "ProfessorPayment" RENAME TO "ProfessorPayment_keep_history";

ALTER TABLE "PaymentAllocation" RENAME COLUMN "earningId" TO "chargeId";
ALTER TABLE "PaymentAllocation" RENAME CONSTRAINT "PaymentAllocation_earningId_fkey" TO "PaymentAllocation_chargeId_fkey";
ALTER INDEX "PaymentAllocation_earningId_voidedAt_idx" RENAME TO "PaymentAllocation_chargeId_voidedAt_idx";

CREATE UNIQUE INDEX "Classroom_name_insensitive_key" ON "Classroom" (lower(btrim(name)));

-- The same row locks are taken by activation services and booking guards.
CREATE FUNCTION validate_active_session_resources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room_active boolean; professor_active boolean;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.status <> 'ANNULEE') OR (TG_OP = 'UPDATE' AND NEW.status = 'PLANIFIEE') THEN
    SELECT active INTO room_active FROM "Classroom" WHERE id=NEW."classroomId" FOR UPDATE;
    SELECT active INTO professor_active FROM "Teacher" WHERE id=NEW."teacherId" FOR UPDATE;
    IF room_active IS NOT TRUE THEN RAISE EXCEPTION 'Cette salle est inactive.' USING ERRCODE='23514'; END IF;
    IF professor_active IS NOT TRUE THEN RAISE EXCEPTION 'Ce professeur est inactif.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TeachingSession_active_resources" BEFORE INSERT OR UPDATE OF "classroomId","teacherId","startAt","endAt",status
  ON "TeachingSession" FOR EACH ROW EXECUTE FUNCTION validate_active_session_resources();

CREATE FUNCTION prevent_classroom_deactivation_with_bookings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM "TeachingSession" WHERE "classroomId"=NEW.id AND status='PLANIFIEE' AND "endAt">CURRENT_TIMESTAMP
  ) THEN RAISE EXCEPTION 'Cette salle possède des séances planifiées à venir ou en cours.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Classroom_deactivation_guard" BEFORE UPDATE OF active ON "Classroom"
  FOR EACH ROW EXECUTE FUNCTION prevent_classroom_deactivation_with_bookings();

INSERT INTO "AuditLog" (id,action,"entityType","entityId",reason)
VALUES (gen_random_uuid(),'CORRECTION_MODELE_FINANCIER','Application','professor-receipts','Les professeurs paient le centre. Renommage sans suppression de données ; ancien registre financier vérifié vide.');
COMMIT;
