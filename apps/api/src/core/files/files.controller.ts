import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { Audit } from '../../common/decorators/audit.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { ErrorCode } from '../../common/types/response.types';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { FilesService } from './files.service';
import { UploadInterceptor } from './upload.interceptor';

type MulterFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
type AuthRequestWithFile = Request & {
  user: AuthenticatedUser;
  file?: MulterFile;
  body: Record<string, unknown>;
};
type AuthRequest = Request & { user: AuthenticatedUser };

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(UploadInterceptor)
  @Audit({ action: AUDIT_ACTIONS.FILE_UPLOADED, resource: 'file' })
  async upload(@Req() req: AuthRequestWithFile) {
    const file = req.file;
    if (!file) {
      throw new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: "Missing 'file' field in upload" },
        HttpStatus.BAD_REQUEST,
      );
    }

    const rawPurpose = req.body['purpose'];
    const purpose =
      typeof rawPurpose === 'string' && rawPurpose.length > 0 ? rawPurpose : undefined;

    const created = await this.filesService.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      claimedMimeType: file.mimetype,
      ownerUserId: req.user.id,
      purpose,
    });

    return {
      id: created.id,
      path: created.path,
      originalName: created.originalName,
      mimeType: created.mimeType,
      size: created.size,
      sha256: created.sha256,
      createdAt: created.createdAt,
    };
  }

  @Get(':id')
  @Audit({ action: AUDIT_ACTIONS.FILE_METADATA_READ, resource: 'file', resourceIdParam: 'id' })
  async getMetadata(@Param('id') id: string, @Req() req: AuthRequest) {
    const file = await this.filesService.findReadableById(this.parseId(id), req.user.id);
    // SECURITY: never expose `path` — it leaks the on-disk layout. Callers
    // should always reach the bytes through GET :id/download, which goes
    // through the permission check.
    return {
      id: file.id,
      ownerUserId: file.ownerUserId,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      sha256: file.sha256,
      createdAt: file.createdAt,
    };
  }

  @Get(':id/download')
  @Audit({ action: AUDIT_ACTIONS.FILE_DOWNLOADED, resource: 'file', resourceIdParam: 'id' })
  async download(
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Req() req: AuthRequest,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { stream, mimeType, originalName, size } = await this.filesService.streamForDownload(
      this.parseId(id),
      req.user.id,
    );

    const isInline = inline === 'true';
    const disposition = `${isInline ? 'inline' : 'attachment'}; ${this.formatFilename(originalName)}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', size.toString());
    res.setHeader('Content-Disposition', disposition);
    // Range requests are deliberately not advertised in v1 — clients fall
    // back to a single full-body GET. v1.5 will add Accept-Ranges if a
    // module needs streaming video.

    stream.pipe(res);
    await new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
      res.on('close', resolve);
    });
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  // Encodes filename per RFC 6266: ASCII fallback for old clients plus
  // RFC 5987 `filename*=UTF-8''…` for unicode (Persian) names. Quotes any
  // " or \ in the ASCII fallback so the header can't be terminated early.
  private formatFilename(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(name);
    return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
  }
}
