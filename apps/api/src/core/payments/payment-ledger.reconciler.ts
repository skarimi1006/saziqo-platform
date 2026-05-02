import { Injectable, Logger } from '@nestjs/common';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

// CLAUDE: Bridges an externally-confirmed Payment to the internal ledger.
// Called from PaymentsService.handleCallback's success branch right after
// the Payment is marked SUCCEEDED. Idempotency relies on the ledger row's
// `reference` field — once a row tagged `payment:<id>` exists, subsequent
// reconcile calls for that payment are no-ops, so retries (manual admin
// re-run, callback retry after partial failure) are safe.
//
// SECURITY: Only the `wallet_topup` purpose mints a ledger credit at the
// system level. `subscription` and `order:*` payments are passive — the
// originating module fulfils them by polling Payment.status (10D's status
// endpoint) and is responsible for any ledger movement on its own
// counters. An unknown purpose is treated as a no-op and logged so it
// surfaces in reconciliation rather than silently inflating a wallet.
@Injectable()
export class PaymentLedgerReconciler {
  private readonly logger = new Logger(PaymentLedgerReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
  ) {}

  async reconcile(paymentId: bigint): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      this.logger.warn(`Reconcile: payment ${paymentId.toString()} not found — skipping`);
      return;
    }

    const reference = `payment:${paymentId.toString()}`;
    const existing = await this.prisma.ledgerEntry.findFirst({
      where: { reference },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `Reconcile: payment ${paymentId.toString()} already has ledger entry ${existing.id.toString()} — skipping`,
      );
      return;
    }

    if (payment.purpose === 'wallet_topup') {
      const wallet = await this.wallets.findOrCreateForUser(payment.userId);
      await this.ledger.credit({
        walletId: wallet.id,
        amount: payment.amount,
        reference,
        description: `Wallet topup — payment #${paymentId.toString()}`,
        metadata: { paymentId: paymentId.toString() },
      });
      this.logger.log(
        `Reconcile: payment ${paymentId.toString()} credited ${payment.amount.toString()} toman to wallet ${wallet.id.toString()}`,
      );
      return;
    }

    if (payment.purpose === 'subscription' || payment.purpose.startsWith('order:')) {
      this.logger.debug(
        `Reconcile: payment ${paymentId.toString()} purpose '${payment.purpose}' is module-handled — no ledger change`,
      );
      return;
    }

    this.logger.warn(
      `Reconcile: payment ${paymentId.toString()} unknown purpose '${payment.purpose}' — skipping (no ledger change)`,
    );
  }
}
