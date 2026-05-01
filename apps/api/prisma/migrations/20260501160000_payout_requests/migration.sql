-- Add PayoutRequest table and PayoutStatus enum for the payout queue
-- and manual approval workflow.

CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'CANCELLED');

CREATE TABLE "payout_requests" (
    "id"               BIGSERIAL PRIMARY KEY,
    "userId"           BIGINT       NOT NULL REFERENCES "users"("id"),
    "walletId"         BIGINT       NOT NULL REFERENCES "wallets"("id"),
    "amount"           BIGINT       NOT NULL,
    "bankAccount"      VARCHAR(34)  NOT NULL,
    "accountHolder"    VARCHAR(200) NOT NULL,
    "status"           "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" BIGINT       REFERENCES "users"("id"),
    "reviewedAt"       TIMESTAMP(3),
    "rejectionReason"  VARCHAR(500),
    "paidAt"           TIMESTAMP(3),
    "paymentReference" VARCHAR(120)
);

CREATE INDEX "payout_requests_userId_idx"      ON "payout_requests"("userId");
CREATE INDEX "payout_requests_status_idx"      ON "payout_requests"("status");
CREATE INDEX "payout_requests_submittedAt_idx" ON "payout_requests"("submittedAt");
