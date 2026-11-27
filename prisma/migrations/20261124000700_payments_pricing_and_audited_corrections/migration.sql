-- Add pricing/receipt metadata without changing historical amounts.
BEGIN;
SELECT pg_advisory_xact_lock(736204);
CREATE TYPE "PricingSource" AS ENUM ('HABITUEL', 'EXCEPTIONNEL');
ALTER TABLE "TeachingSession" ADD COLUMN "priceOverride" DECIMAL(14,3);
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_nonnegative_override" CHECK ("priceOverride" IS NULL OR "priceOverride">=0);
ALTER TABLE "SessionCharge" ADD COLUMN "pricingSource" "PricingSource" NOT NULL DEFAULT 'HABITUEL';
UPDATE "SessionCharge" charge SET "pricingSource"='EXCEPTIONNEL'
FROM "TeachingSession" session WHERE session.id=charge."sessionId" AND length(btrim(COALESCE(session."rateOverrideReason",'')))>0;
ALTER TABLE "ProfessorPayment" ADD COLUMN "recordedById" UUID, ADD COLUMN "replacesId" UUID;
ALTER TABLE "ProfessorPayment" ADD CONSTRAINT "ProfessorPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "AdminUser"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessorPayment" ADD CONSTRAINT "ProfessorPayment_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ProfessorPayment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ProfessorPayment_replacesId_key" ON "ProfessorPayment"("replacesId");
CREATE UNIQUE INDEX "PaymentAllocation_valid_pair_key" ON "PaymentAllocation"("paymentId","chargeId") WHERE "voidedAt" IS NULL;

CREATE TRIGGER "SessionCharge_financial_lock" BEFORE INSERT OR UPDATE OR DELETE ON "SessionCharge" FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "ProfessorPayment_financial_lock" BEFORE INSERT OR UPDATE OR DELETE ON "ProfessorPayment" FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "PaymentAllocation_financial_lock" BEFORE INSERT OR UPDATE OR DELETE ON "PaymentAllocation" FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();

CREATE OR REPLACE FUNCTION preserve_completed_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE correction "AuditLog";
BEGIN
  IF OLD.status<>'TERMINEE' THEN RETURN NEW; END IF;
  IF (NEW."teacherId",NEW."classroomId",NEW."recurrenceId",NEW."occurrenceWeek",NEW."originalDate",NEW."startAt",NEW."endAt",NEW.status,NEW."rateAgreementId",NEW."completedAt")
    IS DISTINCT FROM (OLD."teacherId",OLD."classroomId",OLD."recurrenceId",OLD."occurrenceWeek",OLD."originalDate",OLD."startAt",OLD."endAt",OLD.status,OLD."rateAgreementId",OLD."completedAt") THEN
    RAISE EXCEPTION 'Les informations historiques de cette séance terminée sont protégées.' USING ERRCODE='23514';
  END IF;
  IF (NEW."rateSnapshot",NEW."priceOverride",NEW."rateOverrideReason") IS DISTINCT FROM (OLD."rateSnapshot",OLD."priceOverride",OLD."rateOverrideReason") THEN
    SELECT audit.* INTO correction FROM "AuditLog" audit JOIN "SessionCharge" charge ON charge.id::text=audit."entityId"
      WHERE audit.id=NULLIF(current_setting('app.financial_audit',true),'')::uuid AND audit.action='CORRECTION_TARIF_SEANCE'
      AND audit."entityType"='SessionCharge' AND charge."sessionId"=OLD.id AND length(btrim(COALESCE(audit.reason,'')))>0
      AND (audit.before->>'amount')::numeric=OLD."rateSnapshot" AND (audit.after->>'amount')::numeric=NEW."rateSnapshot";
    IF correction.id IS NULL OR NEW."priceOverride" IS DISTINCT FROM NEW."rateSnapshot" OR NEW."rateOverrideReason" IS DISTINCT FROM correction.reason THEN
      RAISE EXCEPTION 'Un motif et un audit sont requis pour corriger le tarif historique.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preserve_session_charge_values() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE correction "AuditLog";
BEGIN
  IF (NEW."sessionId",NEW."teacherId",NEW."rateAgreementId",NEW."chargedAt",NEW."idempotencyKey",NEW."createdAt")
    IS DISTINCT FROM (OLD."sessionId",OLD."teacherId",OLD."rateAgreementId",OLD."chargedAt",OLD."idempotencyKey",OLD."createdAt") THEN
    RAISE EXCEPTION 'Les références historiques d’une charge sont immuables.' USING ERRCODE='23514';
  END IF;
  IF (NEW.amount,NEW."pricingSource") IS DISTINCT FROM (OLD.amount,OLD."pricingSource") THEN
    SELECT * INTO correction FROM "AuditLog" WHERE id=NULLIF(current_setting('app.financial_audit',true),'')::uuid
      AND action='CORRECTION_TARIF_SEANCE' AND "entityType"='SessionCharge' AND "entityId"=OLD.id::text
      AND length(btrim(COALESCE(reason,'')))>0 AND (before->>'amount')::numeric=OLD.amount AND (after->>'amount')::numeric=NEW.amount;
    IF correction.id IS NULL OR NEW."pricingSource"<>'EXCEPTIONNEL' THEN
      RAISE EXCEPTION 'La correction d’une charge exige un audit correspondant.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF (NEW."voidedAt",NEW."voidReason") IS DISTINCT FROM (OLD."voidedAt",OLD."voidReason") THEN
    RAISE EXCEPTION 'L’annulation directe d’une charge est interdite.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_charge_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "TeachingSession" WHERE id=NEW."sessionId" AND status='TERMINEE'
    AND "teacherId"=NEW."teacherId" AND "rateSnapshot"=NEW.amount) THEN
    RAISE EXCEPTION 'La charge doit correspondre au tarif historique d’une séance terminée du même professeur.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SessionCharge_valid_session" BEFORE INSERT OR UPDATE ON "SessionCharge" FOR EACH ROW EXECUTE FUNCTION validate_charge_session();

CREATE FUNCTION preserve_payment_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."teacherId",NEW.amount,NEW."paymentDate",NEW.method,NEW.reference,NEW.notes,NEW."createdAt",NEW."idempotencyKey",NEW."recordedById",NEW."replacesId")
    IS DISTINCT FROM (OLD."teacherId",OLD.amount,OLD."paymentDate",OLD.method,OLD.reference,OLD.notes,OLD."createdAt",OLD."idempotencyKey",OLD."recordedById",OLD."replacesId") THEN
    RAISE EXCEPTION 'Le paiement original est immuable. Utilisez la correction auditée.' USING ERRCODE='23514';
  END IF;
  IF (NEW."voidedAt",NEW."voidReason") IS DISTINCT FROM (OLD."voidedAt",OLD."voidReason") AND (
    OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "AuditLog" WHERE id=NULLIF(current_setting('app.financial_audit',true),'')::uuid
      AND action IN ('ANNULATION_PAIEMENT','CORRECTION_PAIEMENT') AND "entityType"='ProfessorPayment' AND "entityId"=OLD.id::text
      AND reason=NEW."voidReason" AND length(btrim(COALESCE(reason,'')))>0
    ) OR EXISTS (SELECT 1 FROM "PaymentAllocation" WHERE "paymentId"=OLD.id AND "voidedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Annulez les affectations et fournissez le motif audité avant d’invalider ce paiement.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProfessorPayment_immutable_values" BEFORE UPDATE ON "ProfessorPayment" FOR EACH ROW EXECUTE FUNCTION preserve_payment_values();

CREATE FUNCTION validate_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payment "ProfessorPayment"; charge "SessionCharge"; payment_used numeric; charge_used numeric;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW."paymentId",NEW."chargeId",NEW.amount,NEW."idempotencyKey",NEW."createdAt") IS DISTINCT FROM (OLD."paymentId",OLD."chargeId",OLD.amount,OLD."idempotencyKey",OLD."createdAt") THEN
      RAISE EXCEPTION 'Une affectation historique ne peut pas être réécrite.' USING ERRCODE='23514';
    END IF;
    IF (NEW."voidedAt",NEW."voidReason") IS DISTINCT FROM (OLD."voidedAt",OLD."voidReason") THEN
      IF OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR NOT EXISTS (
        SELECT 1 FROM "AuditLog" audit JOIN "ProfessorPayment" p ON p."teacherId"::text=audit."entityId"
        WHERE audit.id=NULLIF(current_setting('app.financial_audit',true),'')::uuid AND audit.action='REALLOCATION_FIFO'
        AND audit."entityType"='Teacher' AND p.id=OLD."paymentId" AND length(btrim(COALESCE(audit.reason,'')))>0
      ) THEN RAISE EXCEPTION 'La réaffectation doit être auditée sans supprimer l’historique.' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  IF NEW."voidedAt" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO payment FROM "ProfessorPayment" WHERE id=NEW."paymentId" FOR UPDATE;
  SELECT * INTO charge FROM "SessionCharge" WHERE id=NEW."chargeId" FOR UPDATE;
  IF payment.id IS NULL OR charge.id IS NULL OR payment."voidedAt" IS NOT NULL OR charge."voidedAt" IS NOT NULL
    OR payment."teacherId"<>charge."teacherId" OR NOT EXISTS (SELECT 1 FROM "TeachingSession" WHERE id=charge."sessionId" AND status='TERMINEE') THEN
    RAISE EXCEPTION 'L’affectation exige un paiement valide et une charge du même professeur.' USING ERRCODE='23514';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO payment_used FROM "PaymentAllocation" WHERE "paymentId"=NEW."paymentId" AND "voidedAt" IS NULL AND id<>NEW.id;
  SELECT COALESCE(sum(amount),0) INTO charge_used FROM "PaymentAllocation" WHERE "chargeId"=NEW."chargeId" AND "voidedAt" IS NULL AND id<>NEW.id;
  IF NEW.amount<=0 OR payment_used+NEW.amount>payment.amount OR charge_used+NEW.amount>charge.amount THEN
    RAISE EXCEPTION 'L’affectation dépasse le paiement ou le montant restant de la séance.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PaymentAllocation_integrity" BEFORE INSERT OR UPDATE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION validate_allocation();

INSERT INTO "AuditLog" (id,action,"entityType","entityId",reason)
VALUES (gen_random_uuid(),'EVOLUTION_PAIEMENTS','Application','phase4','Tarifs individuels, encaissements et corrections auditées ; montants historiques conservés.');
COMMIT;
