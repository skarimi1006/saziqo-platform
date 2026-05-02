import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// CLAUDE: Phase 10C wires the callback success-path to call this reconciler
// inside the same $transaction as the Payment status update. The actual
// payment-purpose-to-ledger logic (e.g. crediting the wallet on
// `wallet_topup`) is implemented in Phase 10D — this stub keeps the call
// site stable so the callback flow compiles and the SUCCESS branch is
// independently testable in 10C.
@Injectable()
export class PaymentLedgerReconciler {
  private readonly logger = new Logger(PaymentLedgerReconciler.name);

  async reconcile(_tx: Prisma.TransactionClient, paymentId: bigint): Promise<void> {
    this.logger.debug(
      `Payment ${paymentId.toString()} reconciliation deferred to Phase 10D (no-op stub)`,
    );
  }
}
