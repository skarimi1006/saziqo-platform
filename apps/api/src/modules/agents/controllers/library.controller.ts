import { BadRequestException, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { ErrorCode } from '../../../common/types/response.types';
import {
  LibraryService,
  type LibraryDetailDto,
  type LibraryRowDto,
} from '../services/library.service';

interface AuthRequest {
  user: AuthenticatedUser;
}

function parseBigIntParam(name: string, raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new BadRequestException({
      code: ErrorCode.VALIDATION_ERROR,
      message: `Invalid ${name}`,
    });
  }
}

@Controller('agents/me/library')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AgentsLibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @Get()
  @RequirePermission('agents:read:catalog')
  async list(@Req() req: AuthRequest): Promise<{ data: LibraryRowDto[] }> {
    const data = await this.libraryService.findForUser(req.user.id);
    return { data };
  }

  @Get(':listingId')
  @RequirePermission('agents:read:catalog')
  async detail(
    @Req() req: AuthRequest,
    @Param('listingId') listingId: string,
  ): Promise<{ data: LibraryDetailDto }> {
    const data = await this.libraryService.findDetailForUser(
      req.user.id,
      parseBigIntParam('listingId', listingId),
    );
    return { data };
  }
}
