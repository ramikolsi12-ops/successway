-- PostgreSQL is the final arbiter for concurrent scheduling.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Classroom" ADD CONSTRAINT "Classroom_positive_capacity" CHECK (capacity > 0);
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_valid_interval" CHECK ("endAt" > "startAt");
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_nonnegative_snapshot" CHECK ("rateSnapshot" IS NULL OR "rateSnapshot" >= 0);
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_completed_snapshot" CHECK (
  status <> 'TERMINEE' OR (
    "completedAt" IS NOT NULL AND "rateSnapshot" IS NOT NULL AND
    ("contractId" IS NOT NULL OR length(trim(COALESCE("rateOverrideReason", ''))) > 0)
  )
);
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_room_overlap"
  EXCLUDE USING gist ("classroomId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)
  WHERE (status <> 'ANNULEE');
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_teacher_overlap"
  EXCLUDE USING gist ("teacherId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)
  WHERE (status <> 'ANNULEE');
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_group_overlap"
  EXCLUDE USING gist ("groupId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)
  WHERE (status <> 'ANNULEE');

ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_nonnegative_rate" CHECK ("amountPerSession" >= 0);
ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_duration" CHECK ("expectedDurationMinutes" IS NULL OR "expectedDurationMinutes" > 0);
ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_dates" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_scope_overlap"
  EXCLUDE USING gist (
    "teacherId" WITH =,
    (COALESCE("subjectId"::text, '*')) WITH =,
    (COALESCE("groupId"::text, '*')) WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE (active);

ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_valid_interval" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt");
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_membership_overlap"
  EXCLUDE USING gist ("studentId" WITH =, "groupId" WITH =, tstzrange("joinedAt", "leftAt", '[)') WITH &&);

ALTER TABLE "TeacherEarning" ADD CONSTRAINT "TeacherEarning_nonnegative_amount" CHECK (amount >= 0);
ALTER TABLE "TeacherPayment" ADD CONSTRAINT "TeacherPayment_positive_amount" CHECK (amount > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_positive_amount" CHECK (amount > 0);

-- Voiding/correcting financial entries belongs to the audited phase 4 services.
CREATE FUNCTION prevent_history_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La suppression de l’historique financier ou d’audit est interdite.' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "TeacherEarning_keep_history" BEFORE DELETE ON "TeacherEarning"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
CREATE TRIGGER "TeacherPayment_keep_history" BEFORE DELETE ON "TeacherPayment"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
CREATE TRIGGER "PaymentAllocation_keep_history" BEFORE DELETE ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
