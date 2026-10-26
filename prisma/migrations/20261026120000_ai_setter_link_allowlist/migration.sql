-- Domains an auto-sent AI draft may link to besides the booking link.
ALTER TABLE "AiSetterConfig" ADD COLUMN     "allowedLinkDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
