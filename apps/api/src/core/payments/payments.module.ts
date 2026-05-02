import { Module } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletsModule } from '../wallets/wallets.module';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';
import { PaymentsCallbackController } from './payments-callback.controller';
import {
  AdminPaymentsController,
  AdminRefundsController,
  PaymentsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { ConsolePaymentProvider } from './providers/console.provider';
import { ZarinPalProvider } from './providers/zarinpal.provider';

@Module({
  imports: [NotificationsModule, LedgerModule, WalletsModule],
  controllers: [
    PaymentsController,
    AdminPaymentsController,
    AdminRefundsController,
    PaymentsCallbackController,
  ],
  providers: [
    PaymentsService,
    PaymentLedgerReconciler,
    ConsolePaymentProvider,
    ZarinPalProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, ConsolePaymentProvider, ZarinPalProvider],
      useFactory: (
        config: ConfigService,
        consoleProvider: ConsolePaymentProvider,
        zarinpalProvider: ZarinPalProvider,
      ): PaymentProvider => {
        const name = config.get('PAYMENT_PROVIDER');
        if (name === 'zarinpal') {
          return zarinpalProvider;
        }
        if (name === 'console') {
          return consoleProvider;
        }
        throw new Error(`Unknown PAYMENT_PROVIDER: ${String(name)}`);
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, PaymentsService, PaymentLedgerReconciler],
})
export class PaymentsModule {}
