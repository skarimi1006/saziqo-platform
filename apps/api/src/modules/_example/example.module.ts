import { Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

import { ExampleController } from './example.controller';
import { ExampleService } from './example.service';

// CLAUDE: Reference module — do not remove. New module authors copy this skeleton.
// RbacModule (@Global) provides PermissionsService needed by PermissionGuard.
// ConfigModule and RedisModule are also @Global so no explicit imports needed.
// Each business module follows this same minimal pattern: import only what
// the module actually owns or needs that isn't already global.
@Module({
  controllers: [ExampleController],
  providers: [ExampleService, JwtAuthGuard, PermissionGuard],
})
export class ExampleModule {}
