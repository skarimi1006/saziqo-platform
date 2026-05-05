-- CreateEnum
CREATE TYPE "AgentsPricingType" AS ENUM ('FREE', 'ONE_TIME', 'PER_RUN');

-- CreateEnum
CREATE TYPE "AgentsListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AgentsPurchaseStatus" AS ENUM ('COMPLETED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AgentsRunOutcome" AS ENUM ('CONSUMED', 'REFUSED_INSUFFICIENT', 'REFUSED_INVALID_KEY');

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_userId_fkey";

-- DropForeignKey
ALTER TABLE "payout_requests" DROP CONSTRAINT "payout_requests_reviewedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "payout_requests" DROP CONSTRAINT "payout_requests_userId_fkey";

-- DropForeignKey
ALTER TABLE "payout_requests" DROP CONSTRAINT "payout_requests_walletId_fkey";

-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_requestedByUserId_fkey";

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "metadata" DROP DEFAULT;

-- CreateTable
CREATE TABLE "agents_category" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "nameFa" VARCHAR(100) NOT NULL,
    "iconKey" VARCHAR(40) NOT NULL,
    "colorToken" VARCHAR(20) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_listing" (
    "id" BIGSERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "titleFa" VARCHAR(200) NOT NULL,
    "shortDescFa" VARCHAR(300) NOT NULL,
    "longDescFaMd" TEXT NOT NULL,
    "installInstructionsFaMd" TEXT,
    "categoryId" BIGINT NOT NULL,
    "makerUserId" BIGINT NOT NULL,
    "pricingType" "AgentsPricingType" NOT NULL,
    "oneTimePriceToman" BIGINT,
    "status" "AgentsListingStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" VARCHAR(500),
    "suspensionReason" VARCHAR(500),
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "featuredOrder" INTEGER,
    "bundleFileId" BIGINT,
    "apiKeyHash" VARCHAR(64),
    "apiKeyPreview" VARCHAR(20),
    "totalUsers" BIGINT NOT NULL DEFAULT 0,
    "totalRuns" BIGINT NOT NULL DEFAULT 0,
    "ratingAverage" DECIMAL(3,2),
    "ratingCount" BIGINT NOT NULL DEFAULT 0,
    "searchVector" tsvector,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "agents_listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_screenshot" (
    "id" BIGSERIAL NOT NULL,
    "listingId" BIGINT NOT NULL,
    "fileId" BIGINT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "altTextFa" VARCHAR(200),

    CONSTRAINT "agents_screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_run_pack" (
    "id" BIGSERIAL NOT NULL,
    "listingId" BIGINT NOT NULL,
    "nameFa" VARCHAR(80) NOT NULL,
    "runs" BIGINT NOT NULL,
    "priceToman" BIGINT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_run_pack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_cart_item" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "listingId" BIGINT NOT NULL,
    "runPackId" BIGINT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_cart_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_purchase" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "pricingTypeAtSale" "AgentsPricingType" NOT NULL,
    "runPackId" BIGINT,
    "runsGranted" BIGINT NOT NULL DEFAULT 0,
    "amountToman" BIGINT NOT NULL,
    "commissionToman" BIGINT NOT NULL,
    "makerEarnedToman" BIGINT NOT NULL,
    "systemPaymentId" BIGINT,
    "status" "AgentsPurchaseStatus" NOT NULL DEFAULT 'COMPLETED',
    "refundReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "agents_purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_user_runs" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "remainingRuns" BIGINT NOT NULL DEFAULT 0,
    "totalGranted" BIGINT NOT NULL DEFAULT 0,
    "totalConsumed" BIGINT NOT NULL DEFAULT 0,
    "lastConsumedAt" TIMESTAMP(3),

    CONSTRAINT "agents_user_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_run_event" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "outcome" "AgentsRunOutcome" NOT NULL,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_run_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_review" (
    "id" BIGSERIAL NOT NULL,
    "listingId" BIGINT NOT NULL,
    "authorUserId" BIGINT NOT NULL,
    "rating" INTEGER NOT NULL,
    "bodyFa" VARCHAR(2000),
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "hiddenReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents_settings" (
    "id" BIGINT NOT NULL DEFAULT 1,
    "commissionPercent" INTEGER NOT NULL DEFAULT 20,
    "heroTitleFa" VARCHAR(200) NOT NULL DEFAULT 'عامل‌های فارسی، به دست سازندگان ایرانی.',
    "heroSubtitleFa" VARCHAR(500) NOT NULL DEFAULT 'از پنل کشف عامل‌های آماده، تا استودیوی انتشار و کسب درآمد — همه در یک جا، با پرداخت ریالی، روی سرور ایران.',
    "showFeaturedSection" BOOLEAN NOT NULL DEFAULT true,
    "showCategoriesSection" BOOLEAN NOT NULL DEFAULT true,
    "showBestSellersSection" BOOLEAN NOT NULL DEFAULT true,
    "showNewReleasesSection" BOOLEAN NOT NULL DEFAULT true,
    "showRecentActivitySection" BOOLEAN NOT NULL DEFAULT true,
    "featuredItemCount" INTEGER NOT NULL DEFAULT 6,
    "bestSellersItemCount" INTEGER NOT NULL DEFAULT 8,
    "newReleasesItemCount" INTEGER NOT NULL DEFAULT 8,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" BIGINT,

    CONSTRAINT "agents_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_category_slug_key" ON "agents_category"("slug");

-- CreateIndex
CREATE INDEX "agents_category_order_idx" ON "agents_category"("order");

-- CreateIndex
CREATE INDEX "agents_category_isActive_idx" ON "agents_category"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "agents_listing_slug_key" ON "agents_listing"("slug");

-- CreateIndex
CREATE INDEX "agents_listing_status_publishedAt_idx" ON "agents_listing"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "agents_listing_categoryId_status_idx" ON "agents_listing"("categoryId", "status");

-- CreateIndex
CREATE INDEX "agents_listing_makerUserId_idx" ON "agents_listing"("makerUserId");

-- CreateIndex
CREATE INDEX "agents_listing_isFeatured_featuredOrder_idx" ON "agents_listing"("isFeatured", "featuredOrder");

-- CreateIndex
CREATE INDEX "agents_listing_deletedAt_idx" ON "agents_listing"("deletedAt");

-- CreateIndex
CREATE INDEX "agents_screenshot_listingId_order_idx" ON "agents_screenshot"("listingId", "order");

-- CreateIndex
CREATE INDEX "agents_run_pack_listingId_order_idx" ON "agents_run_pack"("listingId", "order");

-- CreateIndex
CREATE INDEX "agents_cart_item_userId_addedAt_idx" ON "agents_cart_item"("userId", "addedAt");

-- CreateIndex
CREATE UNIQUE INDEX "agents_cart_item_userId_listingId_runPackId_key" ON "agents_cart_item"("userId", "listingId", "runPackId");

-- CreateIndex
CREATE INDEX "agents_purchase_userId_createdAt_idx" ON "agents_purchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "agents_purchase_listingId_createdAt_idx" ON "agents_purchase"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "agents_purchase_status_idx" ON "agents_purchase"("status");

-- CreateIndex
CREATE INDEX "agents_user_runs_userId_idx" ON "agents_user_runs"("userId");

-- CreateIndex
CREATE INDEX "agents_user_runs_listingId_idx" ON "agents_user_runs"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_user_runs_userId_listingId_key" ON "agents_user_runs"("userId", "listingId");

-- CreateIndex
CREATE INDEX "agents_run_event_userId_listingId_createdAt_idx" ON "agents_run_event"("userId", "listingId", "createdAt");

-- CreateIndex
CREATE INDEX "agents_run_event_listingId_createdAt_idx" ON "agents_run_event"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "agents_review_listingId_createdAt_idx" ON "agents_review"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "agents_review_authorUserId_idx" ON "agents_review"("authorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_review_listingId_authorUserId_key" ON "agents_review"("listingId", "authorUserId");

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_listing" ADD CONSTRAINT "agents_listing_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "agents_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_listing" ADD CONSTRAINT "agents_listing_makerUserId_fkey" FOREIGN KEY ("makerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_listing" ADD CONSTRAINT "agents_listing_bundleFileId_fkey" FOREIGN KEY ("bundleFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_screenshot" ADD CONSTRAINT "agents_screenshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_screenshot" ADD CONSTRAINT "agents_screenshot_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_run_pack" ADD CONSTRAINT "agents_run_pack_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_cart_item" ADD CONSTRAINT "agents_cart_item_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_cart_item" ADD CONSTRAINT "agents_cart_item_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_cart_item" ADD CONSTRAINT "agents_cart_item_runPackId_fkey" FOREIGN KEY ("runPackId") REFERENCES "agents_run_pack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_purchase" ADD CONSTRAINT "agents_purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_purchase" ADD CONSTRAINT "agents_purchase_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_purchase" ADD CONSTRAINT "agents_purchase_runPackId_fkey" FOREIGN KEY ("runPackId") REFERENCES "agents_run_pack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_purchase" ADD CONSTRAINT "agents_purchase_systemPaymentId_fkey" FOREIGN KEY ("systemPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_user_runs" ADD CONSTRAINT "agents_user_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_user_runs" ADD CONSTRAINT "agents_user_runs_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_run_event" ADD CONSTRAINT "agents_run_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_run_event" ADD CONSTRAINT "agents_run_event_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_review" ADD CONSTRAINT "agents_review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "agents_listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents_review" ADD CONSTRAINT "agents_review_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
