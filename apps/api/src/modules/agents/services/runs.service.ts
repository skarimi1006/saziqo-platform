import { createHash, timingSafeEqual } from 'crypto';

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AgentsListingStatus, AgentsPricingType, AgentsRunOutcome } from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisService } from '../../../core/redis/redis.service';

export interface ConsumeInput {
  listingSlug: string;
  userId: bigint;
  apiKeyPlaintext: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ConsumeResult {
  remainingRuns: string;
  totalConsumed: string;
}

const LOW_RUNS_DEDUP_TTL_SECONDS = 24 * 60 * 60;

// CLAUDE: lowRunsKey lives in Redis with a 24h TTL after first fire.
// CheckoutService.checkout() deletes this key on every PER_RUN purchase
// for (userId, listingId) so a top-up resets the dedup naturally — the
// next time the buyer's balance crosses the 10% threshold, they get
// notified again. Without that reset, a buyer who burns through pack 1,
// gets notified once, buys pack 2, then burns through pack 2 would
// receive zero warning.
export function lowRunsDedupKey(userId: bigint, listingId: bigint): string {
  return `agents:lowruns:${userId.toString()}:${listingId.toString()}`;
}

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    // Step 1: listing must be PUBLISHED. Don't leak existence — every
    // failure mode here returns the same INVALID_API_KEY response.
    const listing = await this.prisma.agents_listing.findFirst({
      where: { slug: input.listingSlug, deletedAt: null },
      select: {
        id: true,
        titleFa: true,
        status: true,
        pricingType: true,
        apiKeyHash: true,
      },
    });

    if (
      !listing ||
      listing.status !== AgentsListingStatus.PUBLISHED ||
      listing.pricingType !== AgentsPricingType.PER_RUN ||
      listing.apiKeyHash === null
    ) {
      throw invalidApiKey();
    }

    // Step 2: user must exist (FK-safe before inserting agents_run_event).
    // Same anti-leak posture: return INVALID_API_KEY.
    const userExists = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!userExists) {
      throw invalidApiKey();
    }

    // Step 3: constant-time hash compare. timingSafeEqual requires equal
    // lengths; sha256 hex is always 64 chars so this is structural.
    const candidateHash = sha256Hex(input.apiKeyPlaintext);
    const candidate = Buffer.from(candidateHash, 'hex');
    const expected = Buffer.from(listing.apiKeyHash, 'hex');
    const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);

    if (!matches) {
      await this.recordEvent({
        userId: input.userId,
        listingId: listing.id,
        outcome: AgentsRunOutcome.REFUSED_INVALID_KEY,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw invalidApiKey();
    }

    // Step 4: atomic decrement with WHERE clause guarding remainingRuns > 0.
    // The single UPDATE ... RETURNING is what makes concurrent consume
    // calls safe — Postgres serializes row writes, so two simultaneous
    // requests at remainingRuns=1 produce exactly one CONSUMED + one
    // REFUSED_INSUFFICIENT, never two CONSUMED.
    const updated = await this.prisma.$queryRaw<
      Array<{ remainingRuns: bigint; totalConsumed: bigint }>
    >`
      UPDATE agents_user_runs
      SET "remainingRuns" = "remainingRuns" - 1,
          "totalConsumed" = "totalConsumed" + 1,
          "lastConsumedAt" = NOW()
      WHERE "userId" = ${input.userId}
        AND "listingId" = ${listing.id}
        AND "remainingRuns" > 0
      RETURNING "remainingRuns", "totalConsumed"
    `;

    if (updated.length === 0) {
      await this.recordEvent({
        userId: input.userId,
        listingId: listing.id,
        outcome: AgentsRunOutcome.REFUSED_INSUFFICIENT,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new HttpException(
        { code: ErrorCode.INSUFFICIENT_RUNS, message: 'No runs remaining' },
        HttpStatus.CONFLICT,
      );
    }

    const remainingRuns = updated[0]!.remainingRuns;
    const totalConsumed = updated[0]!.totalConsumed;

    // Steps 5 + 6: success path — append the CONSUMED event and bump
    // the denormalized listing-wide totalRuns counter.
    await this.recordEvent({
      userId: input.userId,
      listingId: listing.id,
      outcome: AgentsRunOutcome.CONSUMED,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    await this.prisma.agents_listing.update({
      where: { id: listing.id },
      data: { totalRuns: { increment: 1 } },
    });

    // Steps 7 + 8: threshold notifications. Fire-and-forget so a Redis
    // or notification failure cannot poison the consume response.
    void this.dispatchThresholdNotifications({
      userId: input.userId,
      listingId: listing.id,
      listingTitleFa: listing.titleFa,
      remainingRuns,
    }).catch((err) => this.logger.error(`Threshold notification dispatch failed: ${String(err)}`));

    return {
      remainingRuns: remainingRuns.toString(),
      totalConsumed: totalConsumed.toString(),
    };
  }

  private async recordEvent(input: {
    userId: bigint;
    listingId: bigint;
    outcome: AgentsRunOutcome;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    try {
      await this.prisma.agents_run_event.create({
        data: {
          userId: input.userId,
          listingId: input.listingId,
          outcome: input.outcome,
          ipAddress: input.ipAddress ?? null,
          // VarChar(255) on the column — clamp defensively.
          userAgent: input.userAgent !== null ? input.userAgent.slice(0, 255) : null,
        },
      });
    } catch (err) {
      // Audit-style write — never fail the caller if the event row
      // write fails. The HTTP response (success or refusal) is the
      // primary contract; analytics is secondary.
      this.logger.error(`Failed to write agents_run_event (${input.outcome}): ${String(err)}`);
    }
  }

  private async dispatchThresholdNotifications(input: {
    userId: bigint;
    listingId: bigint;
    listingTitleFa: string;
    remainingRuns: bigint;
  }): Promise<void> {
    if (input.remainingRuns === 0n) {
      await this.notifications.dispatch({
        userId: input.userId,
        type: 'AGENTS_RUNS_DEPLETED',
        payload: { listingTitle: input.listingTitleFa },
        channels: ['IN_APP'],
      });
      // Depleted is a separate state from "low" — leave the low-runs
      // dedup key to whatever it was; a future top-up clears it.
      return;
    }

    // lastPackSize = runs in the most recent COMPLETED PER_RUN purchase
    // for this (user, listing). The threshold is 10% of THAT pack so a
    // buyer who bought a small pack gets warned earlier than one who
    // bought a 10× pack.
    const lastPurchase = await this.prisma.agents_purchase.findFirst({
      where: {
        userId: input.userId,
        listingId: input.listingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      select: { runsGranted: true },
    });
    if (!lastPurchase || lastPurchase.runsGranted === 0n) return;

    const lastPackSize = Number(lastPurchase.runsGranted);
    const threshold = BigInt(Math.max(1, Math.ceil(lastPackSize * 0.1)));
    if (input.remainingRuns > threshold) return;

    const dedupKey = lowRunsDedupKey(input.userId, input.listingId);
    const client = this.redis.getClient();
    // SET key NX EX TTL → atomic "claim once per 24h"; returns 'OK' on
    // first set, null when another caller already won the race.
    const claimed = await client.set(dedupKey, '1', 'EX', LOW_RUNS_DEDUP_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') return;

    await this.notifications.dispatch({
      userId: input.userId,
      type: 'AGENTS_RUNS_LOW',
      payload: {
        listingTitle: input.listingTitleFa,
        remaining: Number(input.remainingRuns),
      },
      channels: ['IN_APP'],
    });
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function invalidApiKey(): HttpException {
  return new HttpException(
    { code: ErrorCode.INVALID_API_KEY, message: 'Invalid API key or listing' },
    HttpStatus.UNAUTHORIZED,
  );
}
