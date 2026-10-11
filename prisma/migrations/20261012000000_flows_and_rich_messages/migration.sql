-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FlowEventType" AS ENUM ('STARTED', 'SENT', 'SEND_FAILED', 'CLICKED', 'REPLIED', 'INPUT_VALID', 'INPUT_INVALID', 'CONDITION_TRUE', 'CONDITION_FALSE', 'ACTION', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'FILE');

-- AlterEnum
ALTER TYPE "DmMessageSource" ADD VALUE 'FLOW';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "flowId" TEXT;

-- AlterTable
ALTER TABLE "DmConversation" ADD COLUMN     "customFields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailCapturedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneCapturedAt" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "DmMessage" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "reaction" TEXT,
ADD COLUMN     "replyToMid" TEXT;

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "triggers" JSONB NOT NULL DEFAULT '[]',
    "graph" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "FlowRunStatus" NOT NULL DEFAULT 'RUNNING',
    "currentNodeId" TEXT,
    "waiting" JSONB,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL DEFAULT '{}',
    "sends" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowEvent" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "runId" TEXT,
    "nodeId" TEXT NOT NULL,
    "conversationId" TEXT,
    "type" "FlowEventType" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "buttonId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Flow_workspaceId_idx" ON "Flow"("workspaceId");

-- CreateIndex
CREATE INDEX "Flow_instagramAccountId_status_idx" ON "Flow"("instagramAccountId", "status");

-- CreateIndex
CREATE INDEX "FlowRun_conversationId_status_idx" ON "FlowRun"("conversationId", "status");

-- CreateIndex
CREATE INDEX "FlowRun_flowId_status_idx" ON "FlowRun"("flowId", "status");

-- CreateIndex
CREATE INDEX "FlowEvent_flowId_nodeId_type_idx" ON "FlowEvent"("flowId", "nodeId", "type");

-- CreateIndex
CREATE INDEX "FlowEvent_runId_idx" ON "FlowEvent"("runId");

-- CreateIndex
CREATE INDEX "FlowEvent_createdAt_idx" ON "FlowEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_slug_key" ON "FlowLink"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_flowId_nodeId_buttonId_key" ON "FlowLink"("flowId", "nodeId", "buttonId");

-- CreateIndex
CREATE INDEX "MediaAsset_workspaceId_idx" ON "MediaAsset"("workspaceId");

-- CreateIndex
CREATE INDEX "Automation_flowId_idx" ON "Automation"("flowId");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DmConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEvent" ADD CONSTRAINT "FlowEvent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowEvent" ADD CONSTRAINT "FlowEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowLink" ADD CONSTRAINT "FlowLink_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

