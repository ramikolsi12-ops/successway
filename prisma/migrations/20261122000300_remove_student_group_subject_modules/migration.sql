-- Requested scope reduction: lessons and rates are managed directly per teacher.
-- Existing administrator, classroom, session and financial records are retained.
-- Keep the earlier migrations unchanged for installations that already applied them.
BEGIN;

LOCK TABLE "TeacherContract" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "TeacherContract" DROP CONSTRAINT "TeacherContract_scope_overlap";
ALTER TABLE "TeacherContract" DROP COLUMN "subjectId", DROP COLUMN "groupId";
-- An ambiguous legacy rate causes the entire migration to roll back instead of
-- silently changing, deleting or deactivating any teacher contract.
ALTER TABLE "TeacherContract" ADD CONSTRAINT "TeacherContract_teacher_overlap"
  EXCLUDE USING gist (
    "teacherId" WITH =,
    daterange("startDate", "endDate", '[]') WITH &&
  ) WHERE (active);

ALTER TABLE "TeachingSession" DROP COLUMN "groupId", DROP COLUMN "subjectId";

DROP TABLE "Attendance";
DROP TABLE "StudentGroup";
DROP TABLE "TeacherSubject";
DROP TABLE "Group";
DROP TABLE "Student";
DROP TABLE "EducationLevel";
DROP TABLE "Subject";
DROP TYPE "AttendanceStatus";

INSERT INTO "AuditLog" (id, action, "entityType", "entityId", reason, "after")
VALUES (
  gen_random_uuid(), 'SIMPLIFICATION_SCHEMA', 'Application', 'modules',
  'Suppression des modules étudiants, groupes, matières et présences à la demande de l’administrateur.',
  '{"teacherBasedSessions": true, "teacherBasedContracts": true}'::jsonb
);

COMMIT;
