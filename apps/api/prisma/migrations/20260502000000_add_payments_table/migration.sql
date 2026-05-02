-- Add Payment table and PaymentStatus enum for payment initiation,
-- verification, and lifecycle tracking.

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

CREATE TABLE "payments" (
    "id"                BIGSERIAL PRIMARY KEY,
    "userId"            BIGINT        NOT NULL REFERENCES "users"("id"),
    "amount"            BIGINT        NOT NULL,
    "purpose"           VARCHAR(50)   NOT NULL,
    "description"       VARCHAR(500)  NOT NULL,
    "status"            "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerName"      VARCHAR(40)   NOT NULL,
    "providerReference" VARCHAR(120),
    "referenceCode"     VARCHAR(120),
    "cardPanMasked"     VARCHAR(20),
    "metadata"          JSONB         NOT NULL DEFAULT '{}',
    "initiatedAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"       TIMESTAMP(3),
    "failureReason"     VARCHAR(500)
);

CREATE INDEX "payments_userId_idx"            ON "payments"("userId");
CREATE INDEX "payments_status_idx"            ON "payments"("status");
CREATE INDEX "payments_providerReference_idx" ON "payments"("providerReference");
