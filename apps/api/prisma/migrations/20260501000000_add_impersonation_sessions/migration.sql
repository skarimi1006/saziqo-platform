-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" BIGSERIAL NOT NULL,
    "actorUserId" BIGINT NOT NULL,
    "targetUserId" BIGINT NOT NULL,
    "sessionId" BIGINT,
    "reason" VARCHAR(500) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(500),

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_sessions_actorUserId_idx" ON "impersonation_sessions"("actorUserId");

-- CreateIndex
CREATE INDEX "impersonation_sessions_targetUserId_idx" ON "impersonation_sessions"("targetUserId");

-- CreateIndex
CREATE INDEX "impersonation_sessions_startedAt_idx" ON "impersonation_sessions"("startedAt");
