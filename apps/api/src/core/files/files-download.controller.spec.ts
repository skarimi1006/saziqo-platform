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
import { PermissionsService } from '../rbac/permissions.service';

import { FILE_STORE } from './file-store.interface';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalFileStore } from './local-file-store';
import { UploadInterceptor } from './upload.interceptor';

const OWNER_ID = 7n;
const NON_OWNER_ID = 8n;
const ADMIN_ID = 9n;

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cf' +
    'c0c000000003000100c5d2c2050000000049454e44ae426082',
  'hex',
);

interface State {
  files: Map<bigint, File>;
  authUserId: bigint;
}

describe('FilesController download + metadata', () => {
  let app: INestApplication;
  let storageRoot: string;
  let store: LocalFileStore;
  let state: State;
  let permissions: { userHasPermission: jest.Mock };

  beforeEach(async () => {
    storageRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'saziqo-files-dl-'));
    state = { files: new Map(), authUserId: OWNER_ID };

    const config = {
      get: (key: string) => {
        if (key === 'FILE_STORAGE_ROOT') return storageRoot;
        if (key === 'MAX_UPLOAD_SIZE_MB') return 10;
        throw new Error(`Unexpected key: ${key}`);
      },
    } as unknown as ConfigService;

    store = new LocalFileStore(config);
    await store.onModuleInit();

    permissions = {
      userHasPermission: jest.fn().mockResolvedValue(false),
    };

    // Stamp the test PNG into the store and a fake DB row so we have a
    // real bytes-on-disk file id=1 to read in each scenario.
    const stored = await store.put({
      buffer: PNG_BYTES,
      originalName: 'pic.png',
      mimeType: 'image/png',
      ownerUserId: OWNER_ID,
    });
    const baseFile: File = {
      id: 1n,
      ownerUserId: OWNER_ID,
      path: stored.path,
      originalName: 'pic.png',
      mimeType: 'image/png',
      size: BigInt(PNG_BYTES.length),
      sha256: stored.sha256,
      createdAt: new Date('2026-05-01'),
      deletedAt: null,
    };
    state.files.set(baseFile.id, baseFile);

    const prisma = {
      file: {
        findUnique: jest.fn(async ({ where }) => state.files.get(where.id) ?? null),
      },
    } as unknown as PrismaService;

    const filesService = new FilesService(
      prisma,
      config,
      permissions as unknown as PermissionsService,
      store,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        Reflector,
        UploadInterceptor,
        { provide: FILE_STORE, useValue: store },
        { provide: ConfigService, useValue: config },
        { provide: FilesService, useValue: filesService },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          ctx.switchToHttp().getRequest().user = { id: state.authUserId };
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

  describe('GET /files/:id (metadata)', () => {
    it('returns sanitized metadata for the owner (no path field)', async () => {
      const res = await request(app.getHttpServer()).get('/files/1').expect(200);

      expect(res.body.data).toMatchObject({
        id: '1',
        ownerUserId: OWNER_ID.toString(),
        originalName: 'pic.png',
        mimeType: 'image/png',
      });
      expect(res.body.data.path).toBeUndefined();
    });

    it('returns 404 to a non-owner without admin:read:any_file', async () => {
      state.authUserId = NON_OWNER_ID;
      await request(app.getHttpServer()).get('/files/1').expect(404);
    });

    it('returns 410 GONE for a soft-deleted file owned by the caller', async () => {
      const file = state.files.get(1n)!;
      state.files.set(1n, { ...file, deletedAt: new Date('2026-05-02') });
      const res = await request(app.getHttpServer()).get('/files/1').expect(410);
      expect(res.body.error.code).toBe(ErrorCode.GONE);
    });

    it('returns 404 for a missing file id', async () => {
      const res = await request(app.getHttpServer()).get('/files/9999').expect(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('returns 404 for a non-numeric id', async () => {
      await request(app.getHttpServer()).get('/files/not-a-number').expect(404);
    });
  });

  describe('GET /files/:id/download', () => {
    it('streams identical bytes to the owner with attachment disposition', async () => {
      const res = await request(app.getHttpServer())
        .get('/files/1/download')
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-length']).toBe(String(PNG_BYTES.length));
      expect(res.headers['content-disposition']).toMatch(/^attachment; /);
      expect(res.headers['content-disposition']).toMatch(/filename="pic\.png"/);
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect((res.body as Buffer).equals(PNG_BYTES)).toBe(true);
    });

    it('serves Content-Disposition: inline when ?inline=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/files/1/download?inline=true')
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(/^inline; /);
    });

    it('rejects a non-owner without admin permission with 404 (id-probe protection)', async () => {
      state.authUserId = NON_OWNER_ID;
      await request(app.getHttpServer()).get('/files/1/download').expect(404);
      // Permission was checked before deciding to expose the row.
      expect(permissions.userHasPermission).toHaveBeenCalledWith(
        NON_OWNER_ID,
        'admin:read:any_file',
      );
    });

    it('lets an admin with admin:read:any_file download any file', async () => {
      state.authUserId = ADMIN_ID;
      permissions.userHasPermission.mockResolvedValueOnce(true);

      const res = await request(app.getHttpServer())
        .get('/files/1/download')
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((res.body as Buffer).equals(PNG_BYTES)).toBe(true);
    });

    it('returns 410 for a soft-deleted file even to its owner', async () => {
      const file = state.files.get(1n)!;
      state.files.set(1n, { ...file, deletedAt: new Date('2026-05-02') });
      const res = await request(app.getHttpServer()).get('/files/1/download').expect(410);
      expect(res.body.error.code).toBe(ErrorCode.GONE);
    });

    it('returns 404 for a missing file id', async () => {
      await request(app.getHttpServer()).get('/files/9999/download').expect(404);
    });

    it('encodes Persian filenames with RFC 5987 filename* parameter', async () => {
      const file = state.files.get(1n)!;
      state.files.set(1n, { ...file, originalName: 'تصویر.png' });
      const res = await request(app.getHttpServer()).get('/files/1/download').expect(200);
      // ASCII fallback substitutes non-ASCII chars with _, so attackers
      // cannot inject quotes; the encoded copy preserves the original name.
      expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
      expect(res.headers['content-disposition']).toContain(encodeURIComponent('تصویر.png'));
    });
  });
});
