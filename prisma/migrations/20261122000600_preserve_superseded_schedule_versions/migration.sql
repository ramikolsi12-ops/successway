-- Future versions may be replaced or stopped before their first occurrence.
-- Keep their original values instead of deleting them or rewriting history.
BEGIN;
SELECT pg_advisory_xact_lock(736204);
ALTER TABLE "RecurrenceSchedule" ADD COLUMN "supersededAt" TIMESTAMPTZ(3);
ALTER TABLE "RecurrenceSchedule" DROP CONSTRAINT "RecurrenceSchedule_version_overlap";
ALTER TABLE "RecurrenceSchedule" ADD CONSTRAINT "RecurrenceSchedule_version_overlap"
  EXCLUDE USING gist ("recurrenceId" WITH =, daterange("startDate", "endDate", '[]') WITH &&)
  WHERE ("supersededAt" IS NULL);

CREATE OR REPLACE FUNCTION classroom_has_future_fixed_booking(room_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "RecurrenceSchedule" schedule
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
    WHERE schedule."classroomId"=room_id AND schedule."supersededAt" IS NULL
      AND (schedule."endDate" IS NULL OR occurrence.d<=schedule."endDate")
      AND ((occurrence.d + schedule."endMinute"*interval '1 minute') AT TIME ZONE 'Africa/Tunis')>CURRENT_TIMESTAMP
      AND NOT EXISTS (
        SELECT 1 FROM "TeachingSession" stored WHERE stored."recurrenceId"=schedule."recurrenceId"
          AND stored."occurrenceWeek"=date_trunc('week', occurrence.d::timestamp)::date
      )
  );
$$;
COMMIT;
