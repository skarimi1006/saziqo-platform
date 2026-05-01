import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import multer, { MulterError } from 'multer';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { MAX_UPLOAD_SIZE_KEY } from '../../common/decorators/max-upload-size.decorator';
import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';

// Multer adds `file` to the request object when running .single().
// We extend the Express Request type so handlers can read req.file
// without `any` casts.
type MulterFile = {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
type RequestWithFile = Request & { file?: MulterFile };

const FIELD_NAME = 'file';

// SECURITY: Run multer with memoryStorage so we hold the buffer in process
// memory and never write attacker-controlled bytes to disk before MIME
// sniffing. This caps a single upload at multer's `limits.fileSize`, which
// the interceptor sets per request from @MaxUploadSize / MAX_UPLOAD_SIZE_MB.
@Injectable()
export class UploadInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const overrideMb = this.reflector.getAllAndOverride<number | undefined>(MAX_UPLOAD_SIZE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const limitMb = overrideMb ?? this.config.get('MAX_UPLOAD_SIZE_MB');
    const limitBytes = limitMb * 1024 * 1024;

    const upload = multer({
      storage: multer.memoryStorage(),
      // SECURITY: limits.fileSize stops multer from reading past the cap
      // — the buffer is never grown beyond it. limits.files = 1 stops a
      // client from streaming many small files at once.
      limits: { fileSize: limitBytes, files: 1 },
    }).single(FIELD_NAME);

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithFile>();
    const res = http.getResponse<Response>();

    return from(
      new Promise<void>((resolve, reject) => {
        upload(req, res, (err: unknown) => {
          if (!err) return resolve();
          if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return reject(
              new HttpException(
                {
                  code: ErrorCode.FILE_TOO_LARGE,
                  message: `File exceeds the ${limitMb} MB limit`,
                },
                HttpStatus.PAYLOAD_TOO_LARGE,
              ),
            );
          }
          if (err instanceof MulterError) {
            return reject(
              new HttpException(
                { code: ErrorCode.VALIDATION_ERROR, message: err.message },
                HttpStatus.BAD_REQUEST,
              ),
            );
          }
          return reject(err);
        });
      }),
    ).pipe(switchMap(() => next.handle()));
  }
}
