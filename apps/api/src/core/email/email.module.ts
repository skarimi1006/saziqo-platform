import { Module } from '@nestjs/common';

import { EmailService } from './email.service';
import { ConsoleEmailProvider } from './providers/console.provider';

@Module({
  providers: [ConsoleEmailProvider, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
