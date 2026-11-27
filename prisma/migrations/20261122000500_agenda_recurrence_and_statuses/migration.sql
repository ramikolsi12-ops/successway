-- Additive phase 3 migration. Existing sessions, rates, charges and audit rows remain.
BEGIN;
SELECT pg_advisory_xact_lock(736204);

ALTER TABLE "RecurrenceSeries" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "RecurrenceSchedule" (
  "id" UUID NOT NULL,
  "recurrenceId" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "classroomId" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RecurrenceSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurrenceSchedule_recurrenceId_fkey" FOREIGN KEY ("recurrenceId") REFERENCES "RecurrenceSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecurrenceSchedule_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecurrenceSchedule_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecurrenceSchedule_weekday" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "RecurrenceSchedule_time_range" CHECK ("startMinute" >= 0 AND "startMinute" < 1440 AND "endMinute" > "startMinute" AND "endMinute" <= 1440),
  CONSTRAINT "RecurrenceSchedule_date_range" CHECK ("endDate" IS NULL OR "endDate" >= "startDate"),
  CONSTRAINT "RecurrenceSchedule_version_overlap" EXCLUDE USING gist (
    "recurrenceId" WITH =, daterange("startDate", "endDate", '[]') WITH &&
  )
);
CREATE INDEX "RecurrenceSchedule_recurrenceId_startDate_idx" ON "RecurrenceSchedule"("recurrenceId", "startDate");
CREATE INDEX "RecurrenceSchedule_teacherId_startDate_endDate_idx" ON "RecurrenceSchedule"("teacherId", "startDate", "endDate");
CREATE INDEX "RecurrenceSchedule_classroomId_startDate_endDate_idx" ON "RecurrenceSchedule"("classroomId", "startDate", "endDate");

ALTER TABLE "TeachingSession"
  ADD COLUMN "occurrenceWeek" DATE,
  ADD COLUMN "originalDate" DATE,
  ADD COLUMN "isException" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "startedAt" TIMESTAMPTZ(3),
  ADD COLUMN "absentAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3);

-- Preserve legacy concrete occurrences and stop rather than merge ambiguous history.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "TeachingSession" WHERE "recurrenceId" IS NOT NULL
    GROUP BY "recurrenceId", date_trunc('week', "startAt" AT TIME ZONE 'Africa/Tunis')::date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Une série historique contient plusieurs séances dans la même semaine. Une reprise explicite est nécessaire ; aucune ligne ne sera supprimée.';
  END IF;
END $$;
UPDATE "TeachingSession" SET
  "occurrenceWeek" = date_trunc('week', "startAt" AT TIME ZONE 'Africa/Tunis')::date,
  "originalDate" = ("startAt" AT TIME ZONE 'Africa/Tunis')::date
WHERE "recurrenceId" IS NOT NULL;

CREATE UNIQUE INDEX "TeachingSession_recurrenceId_occurrenceWeek_key" ON "TeachingSession"("recurrenceId", "occurrenceWeek");
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_occurrence_identity" CHECK (
  ("recurrenceId" IS NULL AND "occurrenceWeek" IS NULL AND "originalDate" IS NULL)
  OR ("recurrenceId" IS NOT NULL AND "occurrenceWeek" IS NOT NULL AND "originalDate" IS NOT NULL
      AND extract(isodow FROM "occurrenceWeek")=1
      AND "originalDate" >= "occurrenceWeek" AND "originalDate" < "occurrenceWeek"+7)
);

-- Adjacent intervals are legal; absence and cancellation release availability.
ALTER TABLE "TeachingSession" DROP CONSTRAINT "TeachingSession_room_overlap";
ALTER TABLE "TeachingSession" DROP CONSTRAINT "TeachingSession_teacher_overlap";
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_room_overlap"
  EXCLUDE USING gist ("classroomId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)
  WHERE (status IN ('PLANIFIEE', 'EN_COURS', 'TERMINEE'));
ALTER TABLE "TeachingSession" ADD CONSTRAINT "TeachingSession_teacher_overlap"
  EXCLUDE USING gist ("teacherId" WITH =, tstzrange("startAt", "endAt", '[)') WITH &&)
  WHERE (status IN ('PLANIFIEE', 'EN_COURS', 'TERMINEE'));

-- Statement-level locks run before row locks, matching the agenda services.
CREATE FUNCTION lock_agenda_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(736204);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "TeachingSession_agenda_lock" BEFORE INSERT OR UPDATE OR DELETE ON "TeachingSession"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "RecurrenceSchedule_agenda_lock" BEFORE INSERT OR UPDATE OR DELETE ON "RecurrenceSchedule"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "RecurrenceSeries_agenda_lock" BEFORE INSERT OR UPDATE OR DELETE ON "RecurrenceSeries"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "Classroom_agenda_lock" BEFORE INSERT OR UPDATE OR DELETE ON "Classroom"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();
CREATE TRIGGER "Teacher_agenda_lock" BEFORE INSERT OR UPDATE OR DELETE ON "Teacher"
  FOR EACH STATEMENT EXECUTE FUNCTION lock_agenda_mutation();

CREATE OR REPLACE FUNCTION validate_active_session_resources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room_active boolean; professor_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(736204);
  IF NEW.status IN ('PLANIFIEE', 'EN_COURS') THEN
    SELECT active INTO room_active FROM "Classroom" WHERE id=NEW."classroomId" FOR UPDATE;
    SELECT active INTO professor_active FROM "Teacher" WHERE id=NEW."teacherId" FOR UPDATE;
    IF room_active IS NOT TRUE THEN RAISE EXCEPTION 'Impossible de réserver une salle inactive.' USING ERRCODE='23514'; END IF;
    IF professor_active IS NOT TRUE THEN RAISE EXCEPTION 'Impossible de réserver pour un professeur inactif.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION validate_active_schedule_resources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE room_active boolean; professor_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(736204);
  -- Closing the historical version remains legal after resource deactivation.
  IF TG_OP='INSERT' OR (NEW."teacherId", NEW."classroomId", NEW."weekday", NEW."startMinute", NEW."endMinute", NEW."startDate")
    IS DISTINCT FROM (OLD."teacherId", OLD."classroomId", OLD."weekday", OLD."startMinute", OLD."endMinute", OLD."startDate") THEN
    SELECT active INTO room_active FROM "Classroom" WHERE id=NEW."classroomId" FOR UPDATE;
    SELECT active INTO professor_active FROM "Teacher" WHERE id=NEW."teacherId" FOR UPDATE;
    IF room_active IS NOT TRUE THEN RAISE EXCEPTION 'Impossible de réserver une salle inactive.' USING ERRCODE='23514'; END IF;
    IF professor_active IS NOT TRUE THEN RAISE EXCEPTION 'Impossible de réserver pour un professeur inactif.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RecurrenceSchedule_active_resources" BEFORE INSERT OR UPDATE ON "RecurrenceSchedule"
  FOR EACH ROW EXECUTE FUNCTION validate_active_schedule_resources();

-- Find a future virtual occurrence without expanding an unlimited recurring series.
-- If n occurrences are persisted, n+2 candidate weeks cover all exceptions and
-- the case where today's virtual occurrence has already ended.
CREATE FUNCTION classroom_has_future_fixed_booking(room_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "RecurrenceSchedule" schedule
    JOIN "RecurrenceSeries" series ON series.id=schedule."recurrenceId" AND series.active
    CROSS JOIN LATERAL (
      SELECT greatest(schedule."startDate", (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tunis')::date) AS d
    ) base
    CROSS JOIN LATERAL (
      SELECT base.d + ((schedule.weekday - extract(isodow FROM base.d)::integer + 7) % 7) AS first_day
    ) first_occurrence
    CROSS JOIN LATERAL generate_series(0, (
      SELECT count(*)::integer+1 FROM "TeachingSession" stored WHERE stored."recurrenceId"=schedule."recurrenceId"
    )) weeks(n)
    CROSS JOIN LATERAL (SELECT first_occurrence.first_day + weeks.n*7 AS d) occurrence
    WHERE schedule."classroomId"=room_id
      AND (schedule."endDate" IS NULL OR occurrence.d<=schedule."endDate")
      AND ((occurrence.d + schedule."endMinute"*interval '1 minute') AT TIME ZONE 'Africa/Tunis')>CURRENT_TIMESTAMP
      AND NOT EXISTS (
        SELECT 1 FROM "TeachingSession" stored
        WHERE stored."recurrenceId"=schedule."recurrenceId"
          AND stored."occurrenceWeek"=date_trunc('week', occurrence.d::timestamp)::date
      )
  );
$$;

CREATE OR REPLACE FUNCTION prevent_classroom_deactivation_with_bookings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(736204);
  IF OLD.active AND NOT NEW.active AND (
    EXISTS (SELECT 1 FROM "TeachingSession" WHERE "classroomId"=NEW.id AND status IN ('PLANIFIEE','EN_COURS') AND "endAt">CURRENT_TIMESTAMP)
    OR classroom_has_future_fixed_booking(NEW.id)
  ) THEN
    RAISE EXCEPTION 'Cette salle possède des séances fixes ou provisoires à venir ou en cours. Terminez la programmation, annulez ou réaffectez les séances avant sa désactivation.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION preserve_completed_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='TERMINEE' AND (
    NEW."teacherId", NEW."classroomId", NEW."recurrenceId", NEW."occurrenceWeek", NEW."originalDate",
    NEW."startAt", NEW."endAt", NEW.status, NEW."rateSnapshot", NEW."rateAgreementId", NEW."completedAt"
  ) IS DISTINCT FROM (
    OLD."teacherId", OLD."classroomId", OLD."recurrenceId", OLD."occurrenceWeek", OLD."originalDate",
    OLD."startAt", OLD."endAt", OLD.status, OLD."rateSnapshot", OLD."rateAgreementId", OLD."completedAt"
  ) THEN
    RAISE EXCEPTION 'Une séance terminée et son tarif historique ne peuvent pas être modifiés. Une correction financière auditée est nécessaire.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TeachingSession_completed_history" BEFORE UPDATE ON "TeachingSession"
  FOR EACH ROW EXECUTE FUNCTION preserve_completed_session();
CREATE TRIGGER "TeachingSession_keep_history" BEFORE DELETE ON "TeachingSession"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
CREATE TRIGGER "RecurrenceSeries_keep_history" BEFORE DELETE ON "RecurrenceSeries"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();
CREATE TRIGGER "RecurrenceSchedule_keep_history" BEFORE DELETE ON "RecurrenceSchedule"
  FOR EACH ROW EXECUTE FUNCTION prevent_history_deletion();

CREATE FUNCTION preserve_session_charge_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."sessionId", NEW."teacherId", NEW.amount, NEW."rateAgreementId", NEW."chargedAt", NEW."idempotencyKey")
    IS DISTINCT FROM (OLD."sessionId", OLD."teacherId", OLD.amount, OLD."rateAgreementId", OLD."chargedAt", OLD."idempotencyKey") THEN
    RAISE EXCEPTION 'Le montant et les références d’une charge historique sont immuables.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SessionCharge_immutable_values" BEFORE UPDATE ON "SessionCharge"
  FOR EACH ROW EXECUTE FUNCTION preserve_session_charge_values();

INSERT INTO "AuditLog" (id,action,"entityType","entityId",reason)
VALUES (gen_random_uuid(),'EVOLUTION_AGENDA','Application','horizontal-agenda','Ajout des versions de programmation fixe, exceptions hebdomadaires et statuts opérationnels sans suppression de données.');
COMMIT;
