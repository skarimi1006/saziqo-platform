// TODO(phase-2F): remove alongside DiagnosticsController.

import { Module } from '@nestjs/common';

import { DiagnosticsController } from './diagnostics.controller';

@Module({
  controllers: [DiagnosticsController],
})
export class DiagnosticsModule {}
