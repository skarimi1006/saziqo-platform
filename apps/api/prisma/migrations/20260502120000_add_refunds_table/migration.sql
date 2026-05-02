-- Add Refund table and RefundStatus enum for the admin-driven manual
-- refund workflow. ZarinPal v1 has no automated refund API, so refunds
-- start as PENDING_MANUAL and are flipped to COMPLETED once ops has
-- transferred the funds out-of-band and recorded the bank reference.

CREATE TYPE "RefundStatus" AS ENUM ('PENDING_MANUAL', 'COMPLETED');

CREATE TABLE "refunds" (
    "id"                BIGSERIAL PRIMARY KEY,
    "paymentId"         BIGINT       NOT NULL REFERENCES "payments"("id"),
    "amount"            BIGINT       NOT NULL,
    "reason"            VARCHAR(500) NOT NULL,
    "status"            "RefundStatus" NOT NULL DEFAULT 'PENDING_MANUAL',
    "requestedByUserId" BIGINT       NOT NULL REFERENCES "users"("id"),
    "requestedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"       TIMESTAMP(3),
    "bankReference"     VARCHAR(120)
);

CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");
CREATE INDEX "refunds_status_idx"    ON "refunds"("status");
