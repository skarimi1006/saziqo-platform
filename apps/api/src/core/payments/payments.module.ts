import { Module } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';

import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';
import { ConsolePaymentProvider } from './providers/console.provider';
import { ZarinPalProvider } from './providers/zarinpal.provider';

// CLAUDE: PaymentProvider is bound under the PAYMENT_PROVIDER token so
// callers depend on the interface, not the concrete adapter. The factory
// reads PAYMENT_PROVIDER at module init — switching adapters at runtime
// requires an app restart, which is intentional.
@Module({
  providers: [
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
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
