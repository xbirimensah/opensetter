-- CreateEnum
CREATE TYPE "VoiceCorrectionKind" AS ENUM ('EDIT', 'MANUAL');

-- AlterTable
ALTER TABLE "AiSetterConfig" ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "llmProvider" TEXT,
ADD COLUMN     "strictVoiceEvidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "styleCorpusBuiltAt" TIMESTAMP(3),
ADD COLUMN     "styleCorpusEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "voiceRules" TEXT;

-- CreateTable
CREATE TABLE "StyleCorpusEntry" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StyleCorpusEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceCorrection" (
    "id" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "replyLogId" TEXT,
    "kind" "VoiceCorrectionKind" NOT NULL,
    "avoidText" TEXT,
    "preferText" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "baseUrl" TEXT,
    "defaultModel" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StyleCorpusEntry_sourceMessageId_key" ON "StyleCorpusEntry"("sourceMessageId");

-- CreateIndex
CREATE INDEX "StyleCorpusEntry_instagramAccountId_language_sentAt_idx" ON "StyleCorpusEntry"("instagramAccountId", "language", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceCorrection_replyLogId_key" ON "VoiceCorrection"("replyLogId");

-- CreateIndex
CREATE INDEX "VoiceCorrection_conversationId_createdAt_idx" ON "VoiceCorrection"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCorrection_instagramAccountId_createdAt_idx" ON "VoiceCorrection"("instagramAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_workspaceId_provider_key" ON "AiProviderCredential"("workspaceId", "provider");

-- AddForeignKey
ALTER TABLE "StyleCorpusEntry" ADD CONSTRAINT "StyleCorpusEntry_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleCorpusEntry" ADD CONSTRAINT "StyleCorpusEntry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCorrection" ADD CONSTRAINT "VoiceCorrection_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceCorrection" ADD CONSTRAINT "VoiceCorrection_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
