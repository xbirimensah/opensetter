-- Email + password login. Both nullable: existing users keep signing in by email link.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "passwordUpdatedAt" TIMESTAMP(3);
