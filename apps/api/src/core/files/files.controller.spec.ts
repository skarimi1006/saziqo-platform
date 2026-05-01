import '../../common/bigint-serialization';

import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import { ExecutionContext, INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { File } from '@prisma/client';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

import { FILE_STORE } from './file-store.interface';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalFileStore } from './local-file-store';
import { UploadInterceptor } from './upload.interceptor';

const OWNER_ID = 7n;
const MAX_MB = 10;

// Minimal valid 1×1 PNG (red pixel) — magic bytes are real, so file-type sniffs it.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf' +
    'c0c000000003000100c5d2c2050000000049454e44ae426082',
  'hex',
);

// Minimal valid JPEG (SOI + APP0/JFIF + DQT + SOF0 + DHT + SOS + image data + EOI).
// We construct a small but valid JPEG by hand so file-type recognises it.
function makeJpeg(): Buffer {
  return Buffer.from(
    'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f' +
      '141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b08000100010101' +
      '1100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504' +
      '040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262' +
      '728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a83848586878889' +
      '8a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4' +
      'e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd5d4ffd9',
    'hex',
  );
}

function svgWithScript(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
      '<script>alert(1)</script>' +
      '<rect width="10" height="10" fill="red"/>' +
      '<g onload="alert(2)"><circle cx="5" cy="5" r="2"/></g>' +
      '</svg>',
    'utf8',
  );
}

function safeSvg(): Buffer {
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    'utf8',
  );
}

interface FileServiceMockState {
  files: File[];
}

function makeFilesServiceFromRealStore(
  store: LocalFileStore,
  state: FileServiceMockState,
): FilesService {
  // Real FilesService backed by a fake Prisma whose file.create stamps an id.
  const prisma = {
    file: {
      create: jest.fn(async ({ data }) => {
        const row: File = {
          id: BigInt(state.files.length + 1),
          ownerUserId: data.ownerUserId,
          path: data.path,
          originalName: data.originalName,
          mimeType: data.mimeType,
          size: data.size,
          sha256: data.sha256,
          createdAt: new Date(),
          deletedAt: null,
        };
        state.files.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }) => {
        return state.files.find((f) => f.sha256 === where.sha256) ?? null;
      }),
    },
  };
  const config = {
    get: (key: string) => {
      if (key === 'MAX_UPLOAD_SIZE_MB') return MAX_MB;
      throw new Error(`Unexpected key: ${key}`);
    },
  } as unknown as ConfigService;

  return new FilesService(prisma as unknown as PrismaService, config, store);
}

describe('FilesController (POST /files/upload)', () => {
  let app: INestApplication;
  let storageRoot: string;
  let store: LocalFileStore;
  let serviceState: FileServiceMockState;
  let authenticated: boolean;

  beforeEach(async () => {
    storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'saziqo-files-it-'));
    serviceState = { files: [] };

    const storeConfig = {
      get: (key: string) => {
        if (key === 'FILE_STORAGE_ROOT') return storageRoot;
        if (key === 'MAX_UPLOAD_SIZE_MB') return MAX_MB;
        throw new Error(`Unexpected key: ${key}`);
      },
    } as unknown as ConfigService;
    store = new LocalFileStore(storeConfig);
    await store.onModuleInit();

    const filesService = makeFilesServiceFromRealStore(store, serviceState);

    authenticated = true;

    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        Reflector,
        UploadInterceptor,
        { provide: FILE_STORE, useValue: store },
        { provide: ConfigService, useValue: storeConfig },
        { provide: FilesService, useValue: filesService },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          if (!authenticated) {
            return false;
          }
          ctx.switchToHttp().getRequest().user = { id: OWNER_ID };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
    await fsp.rm(storageRoot, { recursive: true, force: true });
  });

  it('uploads a JPEG with purpose=avatar → 200', async () => {
    const jpeg = makeJpeg();
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'avatar')
      .attach('file', jpeg, { filename: 'me.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(res.body.data.mimeType).toBe('image/jpeg');
    expect(res.body.data.originalName).toBe('me.jpg');
    expect(serviceState.files).toHaveLength(1);
  });

  it('rejects an oversized upload with 413 FILE_TOO_LARGE', async () => {
    // 11 MB of zero bytes — exceeds MAX_UPLOAD_SIZE_MB=10.
    const big = Buffer.alloc(11 * 1024 * 1024);
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'avatar')
      .attach('file', big, { filename: 'big.bin', contentType: 'image/jpeg' })
      .expect(413);

    expect(res.body.error.code).toBe(ErrorCode.FILE_TOO_LARGE);
    expect(serviceState.files).toHaveLength(0);
  });

  it('rejects MIME spoofing: .exe bytes claimed as image/jpeg → MIME_MISMATCH', async () => {
    // PE/COFF magic header — what file-type returns as application/x-msdownload.
    const exe = Buffer.concat([Buffer.from('MZ', 'utf8'), Buffer.alloc(512)]);
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'avatar')
      .attach('file', exe, { filename: 'evil.jpg', contentType: 'image/jpeg' })
      .expect(400);

    expect(res.body.error.code).toBe(ErrorCode.MIME_MISMATCH);
    expect(serviceState.files).toHaveLength(0);
  });

  it('rejects an SVG with <script> as SVG_UNSAFE_CONTENT', async () => {
    const svg = svgWithScript();
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'image')
      .attach('file', svg, { filename: 'bad.svg', contentType: 'image/svg+xml' })
      .expect(422);

    expect(res.body.error.code).toBe(ErrorCode.SVG_UNSAFE_CONTENT);
  });

  it('accepts a clean SVG when purpose allows image/svg+xml', async () => {
    const svg = safeSvg();
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'image')
      .attach('file', svg, { filename: 'good.svg', contentType: 'image/svg+xml' })
      .expect(200);

    expect(res.body.data.mimeType).toBe('image/svg+xml');
    expect(serviceState.files).toHaveLength(1);
  });

  it('returns 401 when the request is not authenticated', async () => {
    authenticated = false;
    await request(app.getHttpServer())
      .post('/files/upload')
      .attach('file', makeJpeg(), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(403);
    // Note: overridden guard's `return false` produces NestJS's
    // ForbiddenException by default. JwtAuthGuard in production throws 401.
    // We validate that the upload is rejected without ever reaching the
    // service, which is the security-relevant invariant.
    expect(serviceState.files).toHaveLength(0);
  });

  it('defaults purpose to "document" when omitted (rejects JPEG since document only allows PDF)', async () => {
    const jpeg = makeJpeg();
    const res = await request(app.getHttpServer())
      .post('/files/upload')
      .attach('file', jpeg, { filename: 'me.jpg', contentType: 'image/jpeg' })
      .expect(415);

    expect(res.body.error.code).toBe(ErrorCode.MIME_NOT_ALLOWED);
    // The error message names the document purpose (the default) so we know
    // the fallback fired rather than e.g. avatar's allow-list.
    expect(res.body.error.message).toContain("'document'");
    expect(serviceState.files).toHaveLength(0);
  });

  it('dedups: same content uploaded twice returns the same file row', async () => {
    const png = PNG_BYTES;

    const first = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'avatar')
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/files/upload')
      .field('purpose', 'avatar')
      .attach('file', png, { filename: 'b.png', contentType: 'image/png' })
      .expect(200);

    expect(second.body.data.path).toBe(first.body.data.path);
    expect(second.body.data.sha256).toBe(first.body.data.sha256);
  });
});
