-- Preserve all receipts, their historical methods/references and allocations.
-- New receipts are cash and every valid receipt must settle existing charges.
BEGIN;
SELECT pg_advisory_xact_lock(736204);
ALTER TABLE "ProfessorPayment" ALTER COLUMN method SET DEFAULT 'ESPECES';

CREATE FUNCTION validate_new_cash_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.method<>'ESPECES' OR NEW.reference IS NOT NULL THEN
    RAISE EXCEPTION 'Les nouveaux paiements sont enregistrés en espèces, sans référence facultative.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProfessorPayment_cash_receipts" BEFORE INSERT ON "ProfessorPayment"
  FOR EACH ROW EXECUTE FUNCTION validate_new_cash_receipt();

CREATE FUNCTION validate_professor_settlement_totals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE professor_id uuid; total_due numeric; total_received numeric;
BEGIN
  IF TG_TABLE_NAME='PaymentAllocation' THEN
    SELECT "teacherId" INTO professor_id FROM "ProfessorPayment" WHERE id=NEW."paymentId";
  ELSE professor_id=NEW."teacherId"; END IF;
  SELECT COALESCE(sum(ch.amount),0) INTO total_due FROM "SessionCharge" ch
    JOIN "TeachingSession" s ON s.id=ch."sessionId"
    WHERE ch."teacherId"=professor_id AND ch."voidedAt" IS NULL AND s.status='TERMINEE';
  SELECT COALESCE(sum(amount),0) INTO total_received FROM "ProfessorPayment"
    WHERE "teacherId"=professor_id AND "voidedAt" IS NULL;
  IF total_received>total_due THEN
    RAISE EXCEPTION 'Les paiements ne peuvent pas dépasser les charges des séances terminées.' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ProfessorPayment" p WHERE p."teacherId"=professor_id AND p."voidedAt" IS NULL
    AND p.amount<>(SELECT COALESCE(sum(a.amount),0) FROM "PaymentAllocation" a
      JOIN "SessionCharge" ch ON ch.id=a."chargeId" JOIN "TeachingSession" s ON s.id=ch."sessionId"
      WHERE a."paymentId"=p.id AND a."voidedAt" IS NULL AND ch."voidedAt" IS NULL
      AND ch."teacherId"=professor_id AND s.status='TERMINEE')
  ) THEN RAISE EXCEPTION 'Chaque paiement valide doit être entièrement affecté à des séances terminées existantes.' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
-- Deferred checks allow an atomic receipt + allocations, or audited reallocation.
CREATE CONSTRAINT TRIGGER "ProfessorPayment_fully_settled" AFTER INSERT OR UPDATE ON "ProfessorPayment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_professor_settlement_totals();
CREATE CONSTRAINT TRIGGER "PaymentAllocation_fully_settled" AFTER INSERT OR UPDATE ON "PaymentAllocation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_professor_settlement_totals();
CREATE CONSTRAINT TRIGGER "SessionCharge_received_cap" AFTER INSERT OR UPDATE ON "SessionCharge"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_professor_settlement_totals();

INSERT INTO "AuditLog" (id,action,"entityType","entityId",reason)
VALUES (gen_random_uuid(),'SIMPLIFICATION_PAIEMENTS','Application','phase4.1','Paiements en espèces entièrement affectés aux séances terminées ; montants et historiques existants conservés.');
COMMIT;
