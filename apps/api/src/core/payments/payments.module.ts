import { Module } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { NotificationsModule } from '../notifications/notifications.module';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';
import { PaymentsCallbackController } from './payments-callback.controller';
import { AdminPaymentsController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ConsolePaymentProvider } from './providers/console.provider';
import { ZarinPalProvider } from './providers/zarinpal.provider';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, AdminPaymentsController, PaymentsCallbackController],
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
