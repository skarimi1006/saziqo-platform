import { Controller, Get, HttpException, HttpStatus, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { ErrorCode } from '../../common/types/response.types';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { PaymentsService } from './payments.service';

// SECURITY: This controller is intentionally PUBLIC — the payment gateway
// (ZarinPal) redirects the user's browser here after they pay, and they
// arrive without a JWT. Authentication is established indirectly: the
// callback is only meaningful when the Authority query param matches the
// providerReference stored at initiation, which is enforced by the
// handleCallback method.
const CallbackQuerySchema = z.object({
  Authority: z.string().min(1).max(120),
  Status: z.enum(['OK', 'NOK']),
});

type CallbackQuery = z.infer<typeof CallbackQuerySchema>;

@Controller()
export class PaymentsCallbackController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments/:paymentId/callback')
  @Audit({
    action: AUDIT_ACTIONS.PAYMENT_CALLBACK_RECEIVED,
    resource: 'payment',
    resourceIdParam: 'paymentId',
  })
  async handlePaymentCallback(
    @Req() _req: Request,
    @Param('paymentId') paymentIdRaw: string,
    @ZodQuery(CallbackQuerySchema) query: CallbackQuery,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const paymentId = this.parseId(paymentIdRaw);

    await this.payments.handleCallback({
      paymentId,
      providerReference: query.Authority,
      providerStatus: query.Status,
    });

    res.redirect(HttpStatus.FOUND, `/payment-result/${paymentId.toString()}`);
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
