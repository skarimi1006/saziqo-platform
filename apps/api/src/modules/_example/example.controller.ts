import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

// CLAUDE: Reference module — do not remove. New module authors copy this skeleton.
// Controller path follows the module contract: /api/v1/{moduleName}/...
// All endpoints require JWT + permission. JwtAuthGuard validates the token;
// PermissionGuard checks the RBAC table for the code set by @RequirePermission.
@Controller('_example')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ExampleController {
  @Get('ping')
  @RequirePermission('_example:read:ping')
  ping(): { pong: boolean; persianName: string } {
    return { pong: true, persianName: 'مثال' };
  }
}
