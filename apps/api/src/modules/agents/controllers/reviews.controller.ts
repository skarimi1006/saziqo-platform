import {
  BadRequestException,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { Audit } from '../../../common/decorators/audit.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../../common/decorators/zod-body.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { ErrorCode } from '../../../common/types/response.types';
import { AGENTS_AUDIT_ACTIONS } from '../contract';
import { ReviewsService, type ReviewDto } from '../services/reviews.service';

const PostReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  bodyFa: z.string().max(2000).optional(),
});

const PatchReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    bodyFa: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => v.rating !== undefined || v.bodyFa !== undefined, {
    message: 'At least one of rating or bodyFa must be provided',
  });

interface AuthRequest {
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

@Controller('agents/me/library')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgentsReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':listingId/review')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('agents:review:owned')
  @Audit({
    action: AGENTS_AUDIT_ACTIONS.AGENTS_REVIEW_POSTED,
    resource: 'agent_listing',
    resourceIdParam: 'listingId',
  })
  async post(
    @Req() req: AuthRequest,
    @Param('listingId') listingId: string,
    @ZodBody(PostReviewSchema) body: z.infer<typeof PostReviewSchema>,
  ): Promise<{ data: ReviewDto }> {
    const data = await this.reviewsService.post({
      userId: req.user.id,
      listingId: parseBigIntParam('listingId', listingId),
      rating: body.rating,
      bodyFa: body.bodyFa ?? null,
    });
    return { data };
  }

  @Patch(':listingId/review')
  @RequirePermission('agents:review:owned')
  @Audit({
    action: AGENTS_AUDIT_ACTIONS.AGENTS_REVIEW_POSTED,
    resource: 'agent_listing',
    resourceIdParam: 'listingId',
  })
  async update(
    @Req() req: AuthRequest,
    @Param('listingId') listingId: string,
    @ZodBody(PatchReviewSchema) body: z.infer<typeof PatchReviewSchema>,
  ): Promise<{ data: ReviewDto }> {
    const data = await this.reviewsService.update({
      userId: req.user.id,
      listingId: parseBigIntParam('listingId', listingId),
      ...(body.rating !== undefined && { rating: body.rating }),
      ...(body.bodyFa !== undefined && { bodyFa: body.bodyFa }),
    });
    return { data };
  }

  @Delete(':listingId/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('agents:review:owned')
  @Audit({
    action: AGENTS_AUDIT_ACTIONS.AGENTS_REVIEW_REMOVED,
    resource: 'agent_listing',
    resourceIdParam: 'listingId',
  })
  async delete(@Req() req: AuthRequest, @Param('listingId') listingId: string): Promise<void> {
    await this.reviewsService.delete({
      userId: req.user.id,
      listingId: parseBigIntParam('listingId', listingId),
    });
  }
}
