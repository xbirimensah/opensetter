-- Audit trail for security-relevant actions (lib/audit.ts). Additive.
ALTER TYPE "OperationalEventSource" ADD VALUE IF NOT EXISTS 'AUDIT';
