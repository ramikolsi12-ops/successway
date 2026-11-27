-- Alternative PostgreSQL smoke test when Node dependencies are unavailable.
-- psql -v ON_ERROR_STOP=1 -f foundation.sql ; all fixture writes are rolled back.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'centre_formation_test' THEN
    RAISE EXCEPTION 'Tests refusés sur une base autre que centre_formation_test';
  END IF;
END $$;

DO $$
DECLARE
  teacher uuid := gen_random_uuid();
  room uuid := gen_random_uuid();
  session_id uuid := gen_random_uuid();
  payment uuid := gen_random_uuid();
  contract uuid := gen_random_uuid();
BEGIN
  INSERT INTO "Teacher" (id,"firstName","lastName",phone,"updatedAt") VALUES (teacher,'Ahmed','Test','20000000',now());
  INSERT INTO "Classroom" (id,name,capacity,"updatedAt") VALUES (room,'Test '||room,20,now());
  INSERT INTO "TeachingSession" (id,"teacherId","classroomId","startAt","endAt","updatedAt")
    VALUES (session_id,teacher,room,'2026-11-23 13:00Z','2026-11-23 15:00Z',now());

  BEGIN
    INSERT INTO "TeachingSession" (id,"teacherId","classroomId","startAt","endAt","updatedAt")
      VALUES (gen_random_uuid(),teacher,room,'2026-11-23 14:00Z','2026-11-23 16:00Z',now());
    RAISE EXCEPTION 'FAIL: chevauchement accepté';
  EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS: chevauchement refusé'; END;

  INSERT INTO "TeachingSession" (id,"teacherId","classroomId","startAt","endAt","updatedAt")
    VALUES (gen_random_uuid(),teacher,room,'2026-11-23 15:00Z','2026-11-23 16:00Z',now());
  RAISE NOTICE 'PASS: séances adjacentes acceptées';
  INSERT INTO "TeachingSession" (id,"teacherId","classroomId","startAt","endAt",status,"updatedAt")
    VALUES (gen_random_uuid(),teacher,room,'2026-11-23 13:00Z','2026-11-23 15:00Z','ANNULEE',now());
  RAISE NOTICE 'PASS: séance annulée sans conflit';

  BEGIN
    UPDATE "TeachingSession" SET status='TERMINEE' WHERE id=session_id;
    RAISE EXCEPTION 'FAIL: finalisation sans tarif acceptée';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: finalisation sans tarif refusée'; END;
  BEGIN
    INSERT INTO "Classroom" (id,name,capacity,"updatedAt") VALUES (gen_random_uuid(),'Invalide',0,now());
    RAISE EXCEPTION 'FAIL: capacité nulle acceptée';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: capacité positive obligatoire'; END;

  INSERT INTO "ProfessorRateAgreement" (id,"teacherId","pricePerSession","startDate","endDate","updatedAt")
    VALUES (contract,teacher,50.000,'2026-01-01','2026-12-31',now());
  BEGIN
    INSERT INTO "ProfessorRateAgreement" (id,"teacherId","pricePerSession","startDate","updatedAt")
      VALUES (gen_random_uuid(),teacher,60.000,'2026-06-01',now());
    RAISE EXCEPTION 'FAIL: convention ambiguë acceptée';
  EXCEPTION WHEN exclusion_violation THEN RAISE NOTICE 'PASS: conventions ambiguës refusées'; END;
  BEGIN
    INSERT INTO "ProfessorPayment" (id,"teacherId","paymentDate",amount,method,"idempotencyKey","updatedAt")
      VALUES (gen_random_uuid(),teacher,CURRENT_DATE,-0.001,'ESPECES',gen_random_uuid()::text,now());
    RAISE EXCEPTION 'FAIL: paiement négatif accepté';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: paiement négatif refusé'; END;
  INSERT INTO "ProfessorPayment" (id,"teacherId","paymentDate",amount,method,"idempotencyKey","updatedAt")
    VALUES (payment,teacher,CURRENT_DATE,12.345,'ESPECES',gen_random_uuid()::text,now());
  IF (SELECT amount FROM "ProfessorPayment" WHERE id=payment) <> 12.345::numeric THEN RAISE EXCEPTION 'FAIL: précision'; END IF;
  RAISE NOTICE 'PASS: trois décimales exactes';
  BEGIN
    DELETE FROM "ProfessorPayment" WHERE id=payment;
    RAISE EXCEPTION 'FAIL: suppression financière acceptée';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: historique financier protégé'; END;
END;
$$;
ROLLBACK;
