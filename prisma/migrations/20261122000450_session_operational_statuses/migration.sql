-- Commit new enum literals before phase 3 constraints reference them.
-- PostgreSQL does not permit using freshly added literals within the same transaction.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'EN_COURS';
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'ABSENT';
