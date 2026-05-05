import { Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';

import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { CheckoutService, type CheckoutSummary } from '../services/checkout.service';

interface AuthRequest {
  user: AuthenticatedUser;
}

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsCheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  async checkout(@Req() req: AuthRequest): Promise<{ data: CheckoutSummary }> {
    const summary = await this.checkoutService.checkout(req.user.id);
    return { data: summary };
  }
}
