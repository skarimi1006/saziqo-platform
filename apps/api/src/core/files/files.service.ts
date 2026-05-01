import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { File, Prisma } from '@prisma/client';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';

import { FILE_STORE, FileStore } from './file-store.interface';
import {
  DEFAULT_PURPOSE,
  MIME_ALLOWLIST_BY_PURPOSE,
  isMimeAllowedForPurpose,
  mimesMatch,
} from './mime-policy';
import { sanitizeSvg } from './svg-sanitizer';

// Permission code that lets an admin read any file regardless of ownership.
// Defined in permissions.catalog.ts; copied here so the service does not
// depend on a barrel import for a single string.
const ADMIN_READ_ANY_FILE = 'admin:read:any_file';

export interface FileDownloadStream {
  stream: NodeJS.ReadableStream;
  mimeType: string;
  originalName: string;
  size: bigint;
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  // The MIME the client sent in the multipart envelope. NEVER trusted —
  // we only use it to detect spoofing against the bytes we sniff.
  claimedMimeType: string;
  ownerUserId: bigint;
  // Purpose drives the allow-list. When undefined, defaults to the most
  // restrictive bucket (`document`) so a misconfigured caller fails closed.
  purpose?: string | undefined;
  // Per-route override (in MB). When undefined, MAX_UPLOAD_SIZE_MB applies.
  maxSizeMb?: number | undefined;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly permissions: PermissionsService,
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
  ) {}

  async upload(input: UploadInput): Promise<File> {
    const purpose = input.purpose ?? DEFAULT_PURPOSE;
    if (!(purpose in MIME_ALLOWLIST_BY_PURPOSE)) {
      throw new HttpException(
        { code: ErrorCode.MIME_NOT_ALLOWED, message: `Unknown upload purpose: ${purpose}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 1. Size check. The interceptor enforces the same limit upstream via
    // multer's `limits.fileSize` so the buffer never reaches us if it
    // would exceed; this check defends modules that call the service
    // directly (e.g. a job that ingests a saved attachment).
    const limitMb = input.maxSizeMb ?? this.config.get('MAX_UPLOAD_SIZE_MB');
    const maxBytes = limitMb * 1024 * 1024;
    if (input.buffer.length > maxBytes) {
      throw new HttpException(
        {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `File exceeds the ${limitMb} MB limit`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // 2. Sniff MIME from the bytes. file-type only knows binary formats —
    // for textual MIMEs (text/plain, image/svg+xml, text/markdown) it
    // returns undefined and we fall back to the claimed type after a
    // sanity check on the content shape.
    const sniffed = await fileTypeFromBuffer(input.buffer);
    const sniffedMime = sniffed?.mime ?? this.fallbackMimeFromContent(input);

    if (!mimesMatch(sniffedMime, input.claimedMimeType)) {
      throw new HttpException(
        {
          code: ErrorCode.MIME_MISMATCH,
          message: `Claimed MIME type ${input.claimedMimeType} does not match detected ${sniffedMime}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 3. Allow-list per purpose.
    if (!isMimeAllowedForPurpose(sniffedMime, purpose)) {
      throw new HttpException(
        {
          code: ErrorCode.MIME_NOT_ALLOWED,
          message: `MIME type ${sniffedMime} is not allowed for purpose '${purpose}'`,
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    // 4. SVG sanitization. We never accept the raw upload — we always
    // serve the sanitized form so an in-band <script> or onclick can't
    // ride into the browser later.
    let bufferToStore = input.buffer;
    if (sniffedMime === 'image/svg+xml') {
      bufferToStore = this.sanitizeSvg(input.buffer);
    }

    // 5. Hand to the FileStore, which writes atomically and dedups.
    const stored = await this.fileStore.put({
      buffer: bufferToStore,
      originalName: input.originalName,
      mimeType: sniffedMime,
      ownerUserId: input.ownerUserId,
    });

    // 6. Persist a row. sha256 is unique in the DB; if the same content
    // was already uploaded by anyone, return that row — the bytes on
    // disk are identical and a single canonical row keeps ownership and
    // permission checks predictable.
    try {
      return await this.prisma.file.create({
        data: {
          ownerUserId: input.ownerUserId,
          path: stored.path,
          originalName: input.originalName,
          mimeType: sniffedMime,
          size: BigInt(stored.size),
          sha256: stored.sha256,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.file.findUnique({
          where: { sha256: stored.sha256 },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  // SECURITY: ownership check enforces that callers only see their own
  // files unless `allowAdmin` is true — controllers pass true after a
  // permission check has already gated admin access.
  async findById(id: bigint, currentUserId: bigint, allowAdmin: boolean = false): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (file.ownerUserId !== currentUserId && !allowAdmin) {
      // 404 (not 403) so a non-owner cannot probe for valid file ids.
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return file;
  }

  async softDelete(id: bigint, userId: bigint): Promise<File> {
    const file = await this.findById(id, userId);
    if (file.deletedAt !== null) return file;
    return this.prisma.file.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // Resolves a File row for read access by `currentUserId`. Owner always
  // sees their own row; everyone else needs `admin:read:any_file`. Soft-
  // deleted rows produce 410 GONE so callers can distinguish "this used to
  // exist" from "this never existed" — for non-owners with no admin
  // permission we still return 404 to avoid id-probe leaks.
  async findReadableById(id: bigint, currentUserId: bigint): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id } });
    if (!file) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const isOwner = file.ownerUserId === currentUserId;
    const hasAdminAccess = isOwner
      ? false
      : await this.permissions.userHasPermission(currentUserId, ADMIN_READ_ANY_FILE);

    if (!isOwner && !hasAdminAccess) {
      // 404 (not 403) so non-admin users cannot probe for valid file ids.
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (file.deletedAt !== null) {
      // The caller is allowed to know about this file (owner or admin); we
      // surface a 410 so they understand it was deleted, not missing.
      throw new HttpException(
        { code: ErrorCode.GONE, message: 'File has been deleted' },
        HttpStatus.GONE,
      );
    }

    return file;
  }

  async streamForDownload(id: bigint, currentUserId: bigint): Promise<FileDownloadStream> {
    const file = await this.findReadableById(id, currentUserId);
    const stream = await this.fileStore.get(file.path);
    return {
      stream,
      mimeType: file.mimeType,
      originalName: file.originalName,
      size: file.size,
    };
  }

  // SECURITY: Strips <script>, <foreignObject>, on* event handlers, and
  // javascript:/data: href targets via svg-sanitizer. If sanitization
  // removed >10% of the markup we refuse — the client either sent
  // something malicious or something the renderer would mangle.
  private sanitizeSvg(buffer: Buffer): Buffer {
    const original = buffer.toString('utf8');
    const sanitized = sanitizeSvg(original);

    if (this.normalizeSvg(sanitized).length < this.normalizeSvg(original).length * 0.9) {
      throw new HttpException(
        {
          code: ErrorCode.SVG_UNSAFE_CONTENT,
          message: 'SVG contains unsafe content that cannot be sanitized cleanly',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return Buffer.from(sanitized, 'utf8');
  }

  private normalizeSvg(s: string): string {
    return s.replace(/\s+/g, '').toLowerCase();
  }

  // Best-effort textual MIME inference for formats `file-type` cannot
  // identify from a magic-byte signature (it only handles binary formats).
  // We trust the claimed MIME only when it falls in the textual allow-list
  // and the content does not look binary.
  private fallbackMimeFromContent(input: UploadInput): string {
    const claim = input.claimedMimeType.toLowerCase();
    const TEXTUAL = new Set(['text/plain', 'text/markdown', 'image/svg+xml']);
    if (!TEXTUAL.has(claim)) {
      // Binary content with no signature match → return a marker that
      // will fail the mismatch check immediately. This also catches
      // .exe-renamed-as-.jpg attempts where file-type returns undefined
      // because the bytes do not match any known format.
      return 'application/octet-stream';
    }
    if (this.looksBinary(input.buffer)) return 'application/octet-stream';
    if (claim === 'image/svg+xml' && !this.looksLikeSvg(input.buffer)) {
      return 'application/octet-stream';
    }
    return claim;
  }

  private looksBinary(buf: Buffer): boolean {
    // Check the first 1 KiB — if there's a NUL byte, treat as binary.
    const len = Math.min(buf.length, 1024);
    for (let i = 0; i < len; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  }

  private looksLikeSvg(buf: Buffer): boolean {
    const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').trimStart();
    return head.startsWith('<svg') || head.startsWith('<?xml');
  }
}
