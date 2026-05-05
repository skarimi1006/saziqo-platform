import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentsListingStatus,
  AgentsPricingType,
  AgentsPurchaseStatus,
  Prisma,
} from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface CheckoutLineSummary {
  purchaseId: string;
  listingId: string;
  listingTitleFa: string;
  pricingType: AgentsPricingType;
  amountToman: string;
  commissionToman: string;
  makerEarnedToman: string;
  runsGranted: string;
}

export interface CheckoutSummary {
  purchaseIds: string[];
  totalAmountToman: string;
  lines: CheckoutLineSummary[];
}

interface CheckoutValidationFailure {
  cartItemId: string;
  listingId: string;
  reason: ErrorCode;
}

interface CartRow {
  id: bigint;
  listingId: bigint;
  runPackId: bigint | null;
}

interface BuiltLine {
  cartItem: CartRow;
  listing: {
    id: bigint;
    titleFa: string;
    pricingType: AgentsPricingType;
    oneTimePriceToman: bigint | null;
    makerUserId: bigint;
  };
  pack: { id: bigint; runs: bigint; priceToman: bigint } | null;
  amountToman: bigint;
  commissionToman: bigint;
  makerEarnedToman: bigint;
  runsGranted: bigint;
}

interface PostCommitPlan {
  buyerUserId: bigint;
  receipts: Array<{ listingTitleFa: string; runs: bigint }>;
  sales: Array<{ makerUserId: bigint; listingTitleFa: string }>;
}

const DEFAULT_COMMISSION_PERCENT = 20;

// CLAUDE: Checkout is the critical write path of the marketplace. Every
// validation re-runs inside a SERIALIZABLE transaction with a row-level
// lock on the cart, so concurrent checkouts for the same user cannot
// double-grant. Real ZarinPal is deferred (master plan §"Cuts deferred
// from v1") — we create COMPLETED purchases with systemPaymentId=null
// today; flipping to live payments is a one-line provider swap that
// fills in systemPaymentId after a successful verify.
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async checkout(userId: bigint): Promise<CheckoutSummary> {
    const { summary, postCommit } = await this.runWithSerializationRetry(userId);

    // Post-commit notifications. Using void so a notification dispatch
    // failure cannot retroactively void an already-committed purchase.
    void this.dispatchPostCommit(postCommit).catch((err) =>
      this.logger.error(`Post-commit notifications failed: ${String(err)}`),
    );

    return summary;
  }

  private async runWithSerializationRetry(
    userId: bigint,
  ): Promise<{ summary: CheckoutSummary; postCommit: PostCommitPlan }> {
    // CLAUDE: SERIALIZABLE isolation can abort the second of two
    // concurrent checkouts with a write-conflict error (Prisma P2034 /
    // Postgres 40001) instead of letting it observe the post-commit
    // empty cart. We retry exactly once; on the retry the FOR UPDATE
    // wait completes after the first commit, so the cart re-read sees
    // the empty state and surfaces EMPTY_CART naturally. A second
    // serialization failure escapes — that pattern would indicate a
    // genuine bug or pathological contention, not a benign race.
    try {
      return await this.runCheckoutTransaction(userId);
    } catch (err) {
      if (isSerializationFailure(err)) {
        this.logger.debug(
          `Checkout serialization failure for user=${userId.toString()} — retrying once`,
        );
        return this.runCheckoutTransaction(userId);
      }
      throw err;
    }
  }

  private async runCheckoutTransaction(
    userId: bigint,
  ): Promise<{ summary: CheckoutSummary; postCommit: PostCommitPlan }> {
    return this.prisma.$transaction(
      async (tx) => {
        // SECURITY: SELECT ... FOR UPDATE serializes concurrent checkouts
        // for the same user — without it, two near-simultaneous calls
        // could each see the same cart and double-grant ownership.
        const cartRows = await tx.$queryRaw<CartRow[]>`
          SELECT id, "listingId", "runPackId"
          FROM agents_cart_item
          WHERE "userId" = ${userId}
          ORDER BY "addedAt" ASC, id ASC
          FOR UPDATE
        `;

        if (cartRows.length === 0) {
          throw new HttpException(
            { code: ErrorCode.EMPTY_CART, message: 'Cart is empty' },
            HttpStatus.BAD_REQUEST,
          );
        }

        const settings = await tx.agents_settings.findUnique({ where: { id: 1n } });
        const commissionPercent = settings?.commissionPercent ?? DEFAULT_COMMISSION_PERCENT;

        // Re-validate every line: a listing may have been suspended,
        // soft-deleted, or had its pack disabled since being added.
        const built: BuiltLine[] = [];
        const failures: CheckoutValidationFailure[] = [];

        for (const cartItem of cartRows) {
          const listing = await tx.agents_listing.findFirst({
            where: { id: cartItem.listingId, deletedAt: null },
            select: {
              id: true,
              titleFa: true,
              pricingType: true,
              oneTimePriceToman: true,
              status: true,
              makerUserId: true,
            },
          });

          if (!listing || listing.status !== AgentsListingStatus.PUBLISHED) {
            failures.push({
              cartItemId: cartItem.id.toString(),
              listingId: cartItem.listingId.toString(),
              reason: ErrorCode.LISTING_NOT_PURCHASABLE,
            });
            continue;
          }

          let pack: BuiltLine['pack'] = null;
          let amountToman: bigint;
          let runsGranted = 0n;

          if (listing.pricingType === AgentsPricingType.PER_RUN) {
            if (cartItem.runPackId === null) {
              failures.push({
                cartItemId: cartItem.id.toString(),
                listingId: cartItem.listingId.toString(),
                reason: ErrorCode.INVALID_RUN_PACK,
              });
              continue;
            }
            const found = await tx.agents_run_pack.findFirst({
              where: {
                id: cartItem.runPackId,
                listingId: listing.id,
                isActive: true,
              },
              select: { id: true, runs: true, priceToman: true },
            });
            if (!found) {
              failures.push({
                cartItemId: cartItem.id.toString(),
                listingId: cartItem.listingId.toString(),
                reason: ErrorCode.INVALID_RUN_PACK,
              });
              continue;
            }
            pack = found;
            amountToman = found.priceToman;
            runsGranted = found.runs;
          } else if (listing.pricingType === AgentsPricingType.ONE_TIME) {
            // SECURITY: also re-check that the buyer hasn't already
            // purchased this listing (a concurrent checkout from
            // another tab could have completed before this txn started).
            const owned = await tx.agents_purchase.findFirst({
              where: {
                userId,
                listingId: listing.id,
                status: AgentsPurchaseStatus.COMPLETED,
              },
              select: { id: true },
            });
            if (owned) {
              failures.push({
                cartItemId: cartItem.id.toString(),
                listingId: cartItem.listingId.toString(),
                reason: ErrorCode.ALREADY_OWNED,
              });
              continue;
            }
            amountToman = listing.oneTimePriceToman ?? 0n;
          } else {
            const owned = await tx.agents_purchase.findFirst({
              where: {
                userId,
                listingId: listing.id,
                status: AgentsPurchaseStatus.COMPLETED,
              },
              select: { id: true },
            });
            if (owned) {
              failures.push({
                cartItemId: cartItem.id.toString(),
                listingId: cartItem.listingId.toString(),
                reason: ErrorCode.ALREADY_OWNED,
              });
              continue;
            }
            amountToman = 0n;
          }

          const commissionToman = (amountToman * BigInt(commissionPercent)) / 100n;
          const makerEarnedToman = amountToman - commissionToman;

          built.push({
            cartItem,
            listing: {
              id: listing.id,
              titleFa: listing.titleFa,
              pricingType: listing.pricingType,
              oneTimePriceToman: listing.oneTimePriceToman,
              makerUserId: listing.makerUserId,
            },
            pack,
            amountToman,
            commissionToman,
            makerEarnedToman,
            runsGranted,
          });
        }

        if (failures.length > 0) {
          // Whole transaction rolls back — frontend shows the failed
          // items; the user fixes their cart and retries.
          throw new HttpException(
            {
              code: ErrorCode.CHECKOUT_VALIDATION_FAILED,
              message: 'One or more cart items can no longer be purchased',
              details: { failures },
            },
            HttpStatus.CONFLICT,
          );
        }

        const lines: CheckoutLineSummary[] = [];
        const purchaseIds: string[] = [];
        let totalAmountToman = 0n;
        const sales: PostCommitPlan['sales'] = [];
        const receipts: PostCommitPlan['receipts'] = [];

        for (const line of built) {
          // Detect first-time buyer BEFORE inserting the new purchase row.
          const priorPurchase = await tx.agents_purchase.findFirst({
            where: {
              userId,
              listingId: line.listing.id,
              status: AgentsPurchaseStatus.COMPLETED,
            },
            select: { id: true },
          });

          const purchase = await tx.agents_purchase.create({
            data: {
              userId,
              listingId: line.listing.id,
              pricingTypeAtSale: line.listing.pricingType,
              runPackId: line.pack?.id ?? null,
              runsGranted: line.runsGranted,
              amountToman: line.amountToman,
              commissionToman: line.commissionToman,
              makerEarnedToman: line.makerEarnedToman,
              systemPaymentId: null,
              status: AgentsPurchaseStatus.COMPLETED,
            },
            select: { id: true },
          });

          if (line.listing.pricingType === AgentsPricingType.PER_RUN && line.pack) {
            await tx.agents_user_runs.upsert({
              where: {
                userId_listingId: { userId, listingId: line.listing.id },
              },
              create: {
                userId,
                listingId: line.listing.id,
                remainingRuns: line.pack.runs,
                totalGranted: line.pack.runs,
              },
              update: {
                remainingRuns: { increment: line.pack.runs },
                totalGranted: { increment: line.pack.runs },
              },
            });
          }

          if (!priorPurchase) {
            await tx.agents_listing.update({
              where: { id: line.listing.id },
              data: { totalUsers: { increment: 1 } },
            });
          }

          totalAmountToman += line.amountToman;
          purchaseIds.push(purchase.id.toString());
          lines.push({
            purchaseId: purchase.id.toString(),
            listingId: line.listing.id.toString(),
            listingTitleFa: line.listing.titleFa,
            pricingType: line.listing.pricingType,
            amountToman: line.amountToman.toString(),
            commissionToman: line.commissionToman.toString(),
            makerEarnedToman: line.makerEarnedToman.toString(),
            runsGranted: line.runsGranted.toString(),
          });

          sales.push({
            makerUserId: line.listing.makerUserId,
            listingTitleFa: line.listing.titleFa,
          });
          receipts.push({
            listingTitleFa: line.listing.titleFa,
            runs: line.runsGranted,
          });
        }

        await tx.agents_cart_item.deleteMany({ where: { userId } });

        const summaryOut: CheckoutSummary = {
          purchaseIds,
          totalAmountToman: totalAmountToman.toString(),
          lines,
        };

        const postCommitOut: PostCommitPlan = {
          buyerUserId: userId,
          receipts,
          sales,
        };

        return { summary: summaryOut, postCommit: postCommitOut };
      },
      {
        // SECURITY: Serializable is required so the cart re-read inside
        // the txn cannot return rows that were already consumed by a
        // concurrent checkout for the same user.
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  private async dispatchPostCommit(plan: PostCommitPlan): Promise<void> {
    for (const receipt of plan.receipts) {
      await this.notifications.dispatch({
        userId: plan.buyerUserId,
        type: 'AGENTS_PURCHASE_RECEIPT',
        payload: { listingTitle: receipt.listingTitleFa, runs: Number(receipt.runs) },
        channels: ['IN_APP'],
      });
    }
    for (const sale of plan.sales) {
      // Maker is never the buyer (cart guard prevents that), so this is
      // safe to dispatch on every sale line.
      await this.notifications.dispatch({
        userId: sale.makerUserId,
        type: 'AGENTS_NEW_SALE',
        payload: { listingTitle: sale.listingTitleFa },
        channels: ['IN_APP'],
      });
    }
  }
}

// Postgres surfaces SERIALIZABLE conflicts as SQLSTATE 40001 and
// deadlocks as 40P01. Prisma's typed-client paths convert these to
// P2034, but $queryRaw bypasses the wrapper and surfaces them inside
// a P2010 (raw-query failure) — we read meta.code (and fall back to the
// message string) to catch both shapes.
function isSerializationFailure(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  const meta = (err.meta ?? {}) as { code?: string };
  if (meta.code === '40001' || meta.code === '40P01') return true;
  return /\b40001\b|\b40P01\b|could not serialize access/.test(err.message);
}
