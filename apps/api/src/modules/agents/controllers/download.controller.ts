import { BadRequestException, Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { Audit } from '../../../common/decorators/audit.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { ErrorCode } from '../../../common/types/response.types';
import { AGENTS_AUDIT_ACTIONS } from '../contract';
import { DownloadService } from '../services/download.service';

interface AuthRequest {
  user: AuthenticatedUser;
}

@Controller('agents/me/library')
@UseGuards(JwtAuthGuard)
export class AgentsDownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @Get(':listingId/download')
  // CLAUDE: Bundles are typically several MB; 30/min/user is generous
  // enough for retries on a flaky connection but tight enough that
  // automated scraping or hot-link abuse hits the cap quickly.
  @RateLimit({ user: '30/min' })
  @Audit({
    action: AGENTS_AUDIT_ACTIONS.AGENTS_BUNDLE_DOWNLOADED,
    resource: 'agent_listing',
    resourceIdParam: 'listingId',
  })
  async download(
    @Param('listingId') listingId: string,
    @Req() req: AuthRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const parsedId = parseBigIntParam('listingId', listingId);
    const { stream, mimeType, size, filenameHint } =
      await this.downloadService.streamBundleForOwner(req.user.id, parsedId);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', size.toString());
    res.setHeader('Content-Disposition', `attachment; ${formatFilename(filenameHint)}`);

    stream.pipe(res);
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      res.on('close', resolve);
    });
  }
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

// RFC 6266: ASCII fallback for legacy clients plus RFC 5987 UTF-8 encoded
// form for unicode names. Quotes any " or \ in the ASCII fallback so the
// header cannot be terminated early.
function formatFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name);
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
