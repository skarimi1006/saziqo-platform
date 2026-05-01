import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';

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

    // `purpose` is read from the multipart body. Multer decodes text fields
    // into strings; anything else (array, undefined) falls through to the
    // service's DEFAULT_PURPOSE.
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
}
