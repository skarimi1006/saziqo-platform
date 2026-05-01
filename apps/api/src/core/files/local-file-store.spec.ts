import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

import { HttpException } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';

import { LocalFileStore } from './local-file-store';

function makeStore(root: string): LocalFileStore {
  const config = {
    get: (key: string) => {
      if (key === 'FILE_STORAGE_ROOT') return root;
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
  return new LocalFileStore(config);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

describe('LocalFileStore', () => {
  let root: string;
  let store: LocalFileStore;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'saziqo-files-'));
    store = makeStore(root);
    await store.onModuleInit();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  describe('put', () => {
    it('writes the buffer at the date-partitioned sha-fanned-out path', async () => {
      const buffer = Buffer.from('hello, world!', 'utf8');
      const expectedSha = createHash('sha256').update(buffer).digest('hex');

      const stored = await store.put({
        buffer,
        originalName: 'greeting.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      expect(stored.sha256).toBe(expectedSha);
      expect(stored.size).toBe(buffer.length);
      expect(stored.mimeType).toBe('text/plain');

      // Path layout: uploads/YYYY/MM/DD/{xx}/{yy}/{sha}.{ext}
      const segments = stored.path.split('/');
      expect(segments[0]).toBe('uploads');
      expect(segments[1]).toMatch(/^\d{4}$/);
      expect(segments[2]).toMatch(/^\d{2}$/);
      expect(segments[3]).toMatch(/^\d{2}$/);
      expect(segments[4]).toBe(expectedSha.slice(0, 2));
      expect(segments[5]).toBe(expectedSha.slice(2, 4));
      expect(segments[6]).toBe(`${expectedSha}.txt`);

      // Bytes on disk match what we wrote.
      const onDisk = await fsp.readFile(path.join(root, stored.path));
      expect(onDisk.equals(buffer)).toBe(true);
    });

    it('rejects unknown MIME types as a defense-in-depth check', async () => {
      await expect(
        store.put({
          buffer: Buffer.from('x'),
          originalName: 'x.bin',
          mimeType: 'application/x-not-a-real-mime',
          ownerUserId: 1n,
        }),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('chooses the correct extension for common image MIMEs', async () => {
      const cases: Array<{ mime: string; ext: string }> = [
        { mime: 'image/jpeg', ext: 'jpg' },
        { mime: 'image/png', ext: 'png' },
        { mime: 'application/pdf', ext: 'pdf' },
      ];

      for (const { mime, ext } of cases) {
        const buf = Buffer.from(`fake-${mime}`);
        const stored = await store.put({
          buffer: buf,
          originalName: `f.${ext}`,
          mimeType: mime,
          ownerUserId: 1n,
        });
        expect(stored.path.endsWith(`.${ext}`)).toBe(true);
      }
    });

    it('dedups: two put() calls with the same buffer return the same path', async () => {
      const buffer = Buffer.from('dedup-me', 'utf8');
      const first = await store.put({
        buffer,
        originalName: 'a.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });
      const second = await store.put({
        buffer,
        originalName: 'b.txt',
        mimeType: 'text/plain',
        ownerUserId: 2n,
      });

      expect(second.path).toBe(first.path);
      expect(second.sha256).toBe(first.sha256);
      expect(second.size).toBe(first.size);

      // Only one file actually on disk under that path.
      const onDisk = await fsp.readFile(path.join(root, first.path));
      expect(onDisk.equals(buffer)).toBe(true);
    });

    it('keeps a malicious originalName quarantined inside the storage root (path is sha-derived)', async () => {
      const buffer = Buffer.from('not actually /etc/passwd', 'utf8');
      const stored = await store.put({
        buffer,
        // Classic traversal attempt — should be ignored entirely because
        // the on-disk path is built from the sha256, not the original name.
        originalName: '../../etc/passwd',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      // Resolved file lives under the storage root.
      const abs = path.resolve(root, stored.path);
      expect(abs.startsWith(path.resolve(root))).toBe(true);
      // No file at the traversal target.
      const traversalProbe = path.resolve(root, '..', '..', 'etc', 'passwd');
      await expect(fsp.access(traversalProbe)).rejects.toBeDefined();
    });

    it('writes the file with mode 0640 (owner rw, group r, world none)', async () => {
      const buffer = Buffer.from('perm-check', 'utf8');
      const stored = await store.put({
        buffer,
        originalName: 'p.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      const stat = await fsp.stat(path.join(root, stored.path));
      // Mask off file-type bits; compare the permission bits only.
       
      expect(stat.mode & 0o777).toBe(0o640);
    });
  });

  describe('get', () => {
    it('returns a stream that produces the original bytes', async () => {
      const buffer = Buffer.from('hello-stream', 'utf8');
      const stored = await store.put({
        buffer,
        originalName: 'g.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      const stream = await store.get(stored.path);
      const out = await streamToBuffer(stream);
      expect(out.equals(buffer)).toBe(true);
    });

    it('throws NOT_FOUND for a missing path', async () => {
      await expect(store.get('uploads/2099/01/01/aa/bb/deadbeef.txt')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('rejects a relative path that escapes the storage root', async () => {
      await expect(store.get('../../../etc/passwd')).rejects.toMatchObject({ status: 404 });
    });

    it('rejects an absolute path outside the storage root', async () => {
      await expect(store.get('/etc/passwd')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('head', () => {
    it('returns metadata for an existing file', async () => {
      const buffer = Buffer.from('head-me', 'utf8');
      const stored = await store.put({
        buffer,
        originalName: 'h.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      const meta = await store.head(stored.path);
      expect(meta).not.toBeNull();
      expect(meta?.size).toBe(buffer.length);
      expect(meta?.sha256).toBe(stored.sha256);
      expect(meta?.mimeType).toBe('text/plain');
      // Cross-realm Date instances trip toBeInstanceOf in some Jest setups;
      // checking getTime() is a more robust shape assertion.
      expect(typeof meta?.storedAt?.getTime()).toBe('number');
    });

    it('returns null for a missing file', async () => {
      const meta = await store.head('uploads/2099/01/01/aa/bb/missing.txt');
      expect(meta).toBeNull();
    });
  });

  describe('delete', () => {
    it('is a no-op in v1 (soft-delete is via DB)', async () => {
      const buffer = Buffer.from('keep-me', 'utf8');
      const stored = await store.put({
        buffer,
        originalName: 'd.txt',
        mimeType: 'text/plain',
        ownerUserId: 1n,
      });

      await expect(store.delete(stored.path)).resolves.toBeUndefined();

      // Bytes remain on disk — the contract is "soft-delete via DB only".
      const stillThere = await fsp.readFile(path.join(root, stored.path));
      expect(stillThere.equals(buffer)).toBe(true);
    });
  });
});
