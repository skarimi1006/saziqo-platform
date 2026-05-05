import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { ZodBody } from '../../../common/decorators/zod-body.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { ErrorCode } from '../../../common/types/response.types';
import { CartAggregatorService } from '../../../core/cart/cart-aggregator.service';
import type { CartLineDescriptor } from '../../../core/cart/cart.types';
import { CartService } from '../services/cart.service';

const AddItemSchema = z.object({
  listingId: z.coerce.bigint(),
  runPackId: z.coerce.bigint().optional(),
});

const MergeSchema = z.object({
  items: z
    .array(
      z.object({
        listingId: z.coerce.bigint(),
        runPackId: z.coerce.bigint().optional(),
      }),
    )
    .max(50),
});

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

interface AuthRequest {
  user: AuthenticatedUser;
}

interface CartLineResponse {
  moduleSource: string;
  moduleItemId: string;
  titleFa: string;
  priceToman: string;
  metadata: Record<string, unknown>;
}

function serializeLine(line: CartLineDescriptor): CartLineResponse {
  return {
    moduleSource: line.moduleSource,
    moduleItemId: line.moduleItemId,
    titleFa: line.titleFa,
    priceToman: line.priceToman.toString(),
    metadata: line.metadata,
  };
}

@Controller('agents/cart')
@UseGuards(JwtAuthGuard)
export class AgentsCartController {
  constructor(
    private readonly cartService: CartService,
    private readonly aggregator: CartAggregatorService,
  ) {}

  @Get()
  async getCart(@Req() req: AuthRequest): Promise<{ data: CartLineResponse[] }> {
    const lines = await this.aggregator.getForUser(req.user.id);
    return { data: lines.map(serializeLine) };
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  async addItem(
    @Req() req: AuthRequest,
    @ZodBody(AddItemSchema) body: z.infer<typeof AddItemSchema>,
  ): Promise<{ data: { cartItemId: string } }> {
    const item = await this.cartService.addItem(req.user.id, {
      listingId: body.listingId,
      runPackId: body.runPackId ?? null,
    });
    return { data: { cartItemId: item.id.toString() } };
  }

  @Delete(':cartItemId')
  @Idempotent()
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeItem(
    @Req() req: AuthRequest,
    @Param('cartItemId') cartItemId: string,
  ): Promise<void> {
    await this.cartService.removeItem(req.user.id, parseBigIntParam('cartItemId', cartItemId));
  }

  @Post('merge')
  @Idempotent()
  async merge(
    @Req() req: AuthRequest,
    @ZodBody(MergeSchema) body: z.infer<typeof MergeSchema>,
  ): Promise<{
    data: {
      merged: number;
      failed: Array<{ listingId: string; runPackId: string | null; reason: string }>;
    };
  }> {
    const result = await this.cartService.mergeGuestCart(
      req.user.id,
      body.items.map((i) => ({ listingId: i.listingId, runPackId: i.runPackId ?? null })),
    );
    return { data: result };
  }
}
