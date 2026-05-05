import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentsPricingType } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';

import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../../common/decorators/zod-body.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { ErrorCode } from '../../../common/types/response.types';
import { RUN_PACKS_MAX, RUN_PACKS_MIN } from '../constants';
import type { CreateListingInput, CreateRunPackInput } from '../services/listings.service';
import { ListingsService } from '../services/listings.service';

// CLAUDE: Slug — lowercase letters/digits with optional single-hyphen
// separators. The trailing `?` group repeats `-?[a-z0-9]` so two hyphens
// in a row never match and a leading hyphen is impossible. 3-120 chars
// per Phase 4A spec.
const SLUG_RE = /^[a-z0-9](-?[a-z0-9])*$/;

// CLAUDE: titleFa allows Persian Unicode block + Arabic block letters,
// Persian/ASCII digits, ASCII letters, whitespace, and a small set of
// safe punctuation. The intent is "no scripts" (no `<`, `>`, no control
// chars) — XSS-safe plain text suitable for cards and detail pages.
const TITLE_FA_RE =
   
  /^[\p{Script=Arabic}\p{Script=Latin}\p{Nd}\s\-_.,!?:؛،؟«»()[\]/'"@&%+#*]+$/u;

const RunPackSchema = z.object({
  nameFa: z.string().min(1).max(80),
  runs: z.coerce.bigint().refine((v) => v > 0n, 'runs must be > 0'),
  priceToman: z.coerce.bigint().refine((v) => v > 0n, 'priceToman must be > 0'),
});

const CreateListingSchema = z
  .object({
    slug: z
      .string()
      .min(3)
      .max(120)
      .regex(SLUG_RE, 'slug must be lowercase letters, digits, and single hyphens'),
    titleFa: z
      .string()
      .min(5)
      .max(200)
      .regex(TITLE_FA_RE, 'titleFa contains disallowed characters'),
    shortDescFa: z.string().min(20).max(300),
    longDescFaMd: z.string().min(100).max(20_000),
    installInstructionsFaMd: z.string().max(20_000).optional(),
    categoryId: z.coerce.bigint(),
    pricingType: z.nativeEnum(AgentsPricingType),
    oneTimePriceToman: z.coerce.bigint().optional(),
    runPacks: z.array(RunPackSchema).min(RUN_PACKS_MIN).max(RUN_PACKS_MAX).optional(),
    bundleFileId: z.coerce.bigint().optional(),
  })
  .superRefine((dto, ctx) => {
    if (dto.pricingType === AgentsPricingType.PER_RUN) {
      if (!dto.runPacks || dto.runPacks.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['runPacks'],
          message: `PER_RUN listings require ${RUN_PACKS_MIN}-${RUN_PACKS_MAX} run packs`,
        });
      }
      if (dto.oneTimePriceToman !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oneTimePriceToman'],
          message: 'oneTimePriceToman is not allowed on PER_RUN listings',
        });
      }
    } else if (dto.pricingType === AgentsPricingType.ONE_TIME) {
      if (dto.oneTimePriceToman === undefined || dto.oneTimePriceToman <= 0n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oneTimePriceToman'],
          message: 'ONE_TIME listings require oneTimePriceToman > 0',
        });
      }
      if (dto.runPacks !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['runPacks'],
          message: 'runPacks are not allowed on ONE_TIME listings',
        });
      }
    } else {
      // FREE
      if (dto.oneTimePriceToman !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['oneTimePriceToman'],
          message: 'oneTimePriceToman is not allowed on FREE listings',
        });
      }
      if (dto.runPacks !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['runPacks'],
          message: 'runPacks are not allowed on FREE listings',
        });
      }
    }
  });

type CreateListingBody = z.infer<typeof CreateListingSchema>;

interface AuthRequest extends Request {
  user: AuthenticatedUser;
}

function parseBigIntParam(name: string, raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_ERROR,
      message: `Invalid ${name}`,
    });
  }
}

function toServiceInput(body: CreateListingBody): CreateListingInput {
  const runPacks: CreateRunPackInput[] | undefined = body.runPacks?.map((p) => ({
    nameFa: p.nameFa,
    runs: p.runs,
    priceToman: p.priceToman,
  }));
  return {
    slug: body.slug,
    titleFa: body.titleFa,
    shortDescFa: body.shortDescFa,
    longDescFaMd: body.longDescFaMd,
    categoryId: body.categoryId,
    pricingType: body.pricingType,
    ...(body.oneTimePriceToman !== undefined && { oneTimePriceToman: body.oneTimePriceToman }),
    ...(body.installInstructionsFaMd !== undefined && {
      installInstructionsFaMd: body.installInstructionsFaMd,
    }),
    ...(body.bundleFileId !== undefined && { bundleFileId: body.bundleFileId }),
    ...(runPacks !== undefined && { runPacks }),
  };
}

@Controller('agents/me/maker/listings')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class MakerListingsController {
  constructor(private readonly listings: ListingsService) {}

  // POST /api/v1/agents/me/maker/listings — submit a new listing draft.
  // Permission seeded for every authenticated user (any user can become a
  // maker by submitting). Idempotent on the Idempotency-Key header so a
  // network retry does not produce two drafts with different slugs.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('agents:create:listing')
  @Idempotent()
  async create(
    @Req() req: AuthRequest,
    @ZodBody(CreateListingSchema) body: CreateListingBody,
  ): Promise<{ data: { id: string; slug: string; status: string } }> {
    const listing = await this.listings.create({
      makerUserId: req.user.id,
      dto: toServiceInput(body),
    });
    return {
      data: {
        id: listing.id.toString(),
        slug: listing.slug,
        status: listing.status,
      },
    };
  }

  // POST /api/v1/agents/me/maker/listings/:id/submit-for-review — DRAFT
  // → PENDING_REVIEW. The audit row (AGENTS_LISTING_SUBMITTED) and the
  // AGENTS_NEW_LISTING_PENDING admin notification are emitted by the
  // service inside the transaction, so no @Audit decorator on this
  // handler — that would write a duplicate row.
  @Post(':id/submit-for-review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('agents:create:listing')
  async submitForReview(
    @Req() req: AuthRequest,
    @Param('id') id: string,
  ): Promise<{ data: { id: string; status: string } }> {
    const listing = await this.listings.submitForReview(parseBigIntParam('id', id), req.user.id, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    return {
      data: {
        id: listing.id.toString(),
        status: listing.status,
      },
    };
  }
}
