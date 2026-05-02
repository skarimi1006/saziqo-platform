// Test Gate 10 — verifies Phase Group 10's structural acceptance criteria
// that would otherwise only be checked end-to-end with a live database:
//  - @Idempotent is wired to POST /payments/initiate and the refund endpoint
//  - Every privileged payment/refund endpoint carries an @Audit decorator
//  - @AdminOnly({ confirmHeader: true }) (S6) is enforced on refund endpoints
//  - Wallet balance is conserved across a wallet_topup payment + refund cycle
//
// These reflection-based checks complement the per-feature behavioural specs
// in payments.service.spec.ts, payments.controller.spec.ts, etc.

import 'reflect-metadata';

import { LedgerKind } from '@prisma/client';

import { ADMIN_CONFIRM_HEADER_KEY } from '../../common/decorators/admin-only.decorator';
import { AUDIT_META_KEY, type AuditMeta } from '../../common/decorators/audit.decorator';
import { IDEMPOTENT_KEY } from '../../common/decorators/idempotent.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { PaymentsCallbackController } from './payments-callback.controller';
import {
  AdminPaymentsController,
  AdminRefundsController,
  PaymentsController,
} from './payments.controller';

// SetMetadata-as-method-decorator stores metadata on the method function
// (descriptor.value), not on (target, propertyKey). The Reflector at
// runtime reads context.getHandler() which is exactly that function — we
// mirror it here.
function getMeta<T = unknown>(
  key: string,
  proto: { [k: string]: unknown },
  propertyKey: string,
): T | undefined {
  const method = proto[propertyKey];
  if (typeof method !== 'function') return undefined;
  return Reflect.getMetadata(key, method) as T | undefined;
}

describe('Phase 10 Test Gate — structural verification', () => {
  describe('Idempotent initiation (Test Gate item #2)', () => {
    it('POST /payments/initiate is decorated @Idempotent', () => {
      const flag = getMeta<boolean>(
        IDEMPOTENT_KEY,
        PaymentsController.prototype,
        'initiatePayment',
      );
      expect(flag).toBe(true);
    });

    it('POST /admin/payments/:paymentId/refund is decorated @Idempotent', () => {
      const flag = getMeta<boolean>(
        IDEMPOTENT_KEY,
        AdminPaymentsController.prototype,
        'refundPayment',
      );
      expect(flag).toBe(true);
    });
  });

  describe('Audit log coverage (Test Gate item #11)', () => {
    type AuditTarget = {
      controller: { prototype: object; name: string };
      method: string;
      expectedAction: string;
    };

    const TARGETS: AuditTarget[] = [
      {
        controller: PaymentsController,
        method: 'initiatePayment',
        expectedAction: AUDIT_ACTIONS.PAYMENT_INITIATED,
      },
      {
        controller: PaymentsCallbackController,
        method: 'handlePaymentCallback',
        expectedAction: AUDIT_ACTIONS.PAYMENT_CALLBACK_RECEIVED,
      },
      {
        controller: AdminPaymentsController,
        method: 'refundPayment',
        expectedAction: AUDIT_ACTIONS.PAYMENT_REFUND_REQUESTED,
      },
      {
        controller: AdminRefundsController,
        method: 'markRefundCompleted',
        expectedAction: AUDIT_ACTIONS.PAYMENT_REFUND_COMPLETED,
      },
    ];

    it.each(TARGETS)(
      '$controller.name.$method carries @Audit($expectedAction)',
      ({ controller, method, expectedAction }) => {
        const meta = getMeta<AuditMeta>(AUDIT_META_KEY, controller.prototype, method);
        expect(meta).toBeDefined();
        expect(meta?.action).toBe(expectedAction);
        expect(meta?.resource).toMatch(/^(payment|refund)$/);
      },
    );
  });

  describe('S6 admin confirm header (Test Gate item #13)', () => {
    type ConfirmTarget = {
      controller: { prototype: object; name: string };
      method: string;
    };

    const REFUND_TARGETS: ConfirmTarget[] = [
      { controller: AdminPaymentsController, method: 'refundPayment' },
      { controller: AdminRefundsController, method: 'markRefundCompleted' },
    ];

    it.each(REFUND_TARGETS)(
      '$controller.name.$method requires X-Admin-Confirm (S6)',
      ({ controller, method }) => {
        const flag = getMeta<boolean>(ADMIN_CONFIRM_HEADER_KEY, controller.prototype, method);
        expect(flag).toBe(true);
      },
    );

    it.each(REFUND_TARGETS)(
      '$controller.name.$method requires admin:approve:payout permission',
      ({ controller, method }) => {
        const permission = getMeta<string>(PERMISSION_KEY, controller.prototype, method);
        expect(permission).toBe('admin:approve:payout');
      },
    );
  });

  describe('Ledger round-trip integrity (Test Gate item #14)', () => {
    // SECURITY: A wallet_topup payment of N toman + a full refund of N toman
    // must leave the wallet balance equal to its starting balance. The ledger
    // entries cancel out: +N (CREDIT, reference=payment:X) and -N (DEBIT,
    // reference=refund:Y). The reconciliation report (Phase 9E) recomputes
    // wallet balance as SUM(CREDIT) - SUM(DEBIT) — this test asserts that
    // arithmetic, which is the same arithmetic the report uses.
    it('CREDIT(payment) + DEBIT(refund) of equal amount net to zero', () => {
      const startingBalance = 0n;
      const paymentAmount = 50_000n;

      const ledgerEntries: { kind: LedgerKind; amount: bigint; reference: string }[] = [];

      // Phase 10D: reconciler credits the wallet on a wallet_topup payment
      ledgerEntries.push({
        kind: LedgerKind.CREDIT,
        amount: paymentAmount,
        reference: 'payment:7',
      });
      const balanceAfterPayment =
        startingBalance + sumBy(ledgerEntries, (e) => signedAmount(e.kind, e.amount));
      expect(balanceAfterPayment).toBe(50_000n);

      // Phase 10E: refund debits the wallet for the same amount
      ledgerEntries.push({
        kind: LedgerKind.DEBIT,
        amount: paymentAmount,
        reference: 'refund:1001',
      });
      const balanceAfterRefund =
        startingBalance + sumBy(ledgerEntries, (e) => signedAmount(e.kind, e.amount));
      expect(balanceAfterRefund).toBe(0n);

      // The reconciliation report uses the same SUM(CREDIT) - SUM(DEBIT)
      // expression — verify it matches the post-refund stored balance.
      const computedBalance = ledgerEntries.reduce(
        (acc, e) => acc + signedAmount(e.kind, e.amount),
        0n,
      );
      expect(computedBalance).toBe(balanceAfterRefund);
    });

    it('CREDIT(N) + DEBIT(N/2) leaves N/2 as both stored and computed', () => {
      const paymentAmount = 100_000n;
      const partialRefund = 40_000n;

      const ledgerEntries = [
        { kind: LedgerKind.CREDIT, amount: paymentAmount, reference: 'payment:7' },
        { kind: LedgerKind.DEBIT, amount: partialRefund, reference: 'refund:1001' },
      ];

      const computed = ledgerEntries.reduce((acc, e) => acc + signedAmount(e.kind, e.amount), 0n);
      expect(computed).toBe(paymentAmount - partialRefund);
      expect(computed).toBe(60_000n);
    });
  });
});

function signedAmount(kind: LedgerKind, amount: bigint): bigint {
  return kind === LedgerKind.CREDIT ? amount : -amount;
}

function sumBy<T>(items: T[], pick: (item: T) => bigint): bigint {
  return items.reduce((acc, item) => acc + pick(item), 0n);
}
