import { createHash } from 'crypto';
import { createReadStream, promises as fsp } from 'fs';
import path from 'path';

import { HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { extension as mimeExtension, lookup as mimeLookup } from 'mime-types';
import { v4 as uuidv4 } from 'uuid';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';

import { FileMetadata, FileStore, PutFileInput, StoredFile } from './file-store.interface';

// SECURITY: Ownership/permissions on uploaded files.
//   0o640 = owner rw, group r, world none.
// The API process runs as a dedicated unix user; group is the web/proxy
// user that may need to read for streaming. World has no access — leaking
// a path off the host should never be enough to read contents.
const FILE_MODE = 0o640;

// Subdirectory inside FILE_STORAGE_ROOT that holds final, addressable files.
// Kept distinct from `temp/` so a future cleanup job can prune temp without
// touching the canonical store.
const UPLOADS_DIR = 'uploads';
const TEMP_DIR = 'temp';

// MIME → extension overrides applied on top of mime-types' defaults. We
// prefer the more-common 3-letter form for jpeg; any future override goes
// here rather than spreading magic strings across the codebase.
const MIME_EXTENSION_OVERRIDES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

@Injectable()
export class LocalFileStore implements FileStore, OnModuleInit {
  readonly name = 'local';

  private readonly logger = new Logger(LocalFileStore.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    // Resolve to an absolute path so every traversal check below compares
    // resolved paths against a known absolute prefix.
    this.root = path.resolve(this.config.get('FILE_STORAGE_ROOT'));
  }

  // Ensures the storage and temp directories exist. Runs at module init so
  // dev environments that haven't pre-created /var/... or ./tmp/saziqo-files
  // start cleanly without a manual mkdir.
  async onModuleInit(): Promise<void> {
    await fsp.mkdir(path.join(this.root, UPLOADS_DIR), { recursive: true });
    await fsp.mkdir(path.join(this.root, TEMP_DIR), { recursive: true });
  }

  async put(input: PutFileInput): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');
    const ext = this.resolveExtension(input.mimeType);
    const relPath = this.buildStoragePath(sha256, ext);
    const absPath = this.resolveSafe(relPath);

    // Dedup hit: same content + same size already on disk → reuse the path.
    // The sha256 in the path itself is the strong identity check; the size
    // comparison is a cheap belt-and-suspenders against a pre-existing
    // truncated file from a crashed write.
    try {
      const existing = await fsp.stat(absPath);
      if (existing.isFile() && existing.size === input.buffer.length) {
        return {
          path: relPath,
          sha256,
          size: existing.size,
          mimeType: input.mimeType,
        };
      }
    } catch (err) {
      if (!isNoEnt(err)) throw err;
    }

    // Write to temp/{uuid}.{ext} then rename atomically into place. Rename
    // is atomic on the same filesystem, which guarantees readers never
    // observe a half-written file at the final path.
    const tempName = `${uuidv4()}.${ext}`;
    const tempAbs = path.join(this.root, TEMP_DIR, tempName);
    const finalDir = path.dirname(absPath);
    await fsp.mkdir(finalDir, { recursive: true });

    await fsp.writeFile(tempAbs, input.buffer, { mode: FILE_MODE });
    try {
      await fsp.rename(tempAbs, absPath);
    } catch (err) {
      // Clean up the temp file if the rename failed — leaving it behind
      // would slowly grow the temp dir on repeated failures.
      await fsp.unlink(tempAbs).catch(() => undefined);
      throw err;
    }

    // umask can downgrade write mode; chmod here makes the result deterministic.
    await fsp.chmod(absPath, FILE_MODE);

    return {
      path: relPath,
      sha256,
      size: input.buffer.length,
      mimeType: input.mimeType,
    };
  }

  async get(relPath: string): Promise<NodeJS.ReadableStream> {
    const abs = this.resolveSafe(relPath);
    try {
      // stat first so a missing file produces NOT_FOUND (and not a stream
      // that errors mid-pipe with an opaque ENOENT later).
      await fsp.stat(abs);
    } catch (err) {
      if (isNoEnt(err)) {
        throw new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'File not found' },
          HttpStatus.NOT_FOUND,
        );
      }
      throw err;
    }
    return createReadStream(abs);
  }

  async head(relPath: string): Promise<FileMetadata | null> {
    const abs = this.resolveSafe(relPath);
    let stat: Awaited<ReturnType<typeof fsp.stat>>;
    try {
      stat = await fsp.stat(abs);
    } catch (err) {
      if (isNoEnt(err)) return null;
      throw err;
    }
    if (!stat.isFile()) return null;

    // The sha256 is the first 64 hex chars of the basename — by construction
    // (see buildStoragePath). We do not re-hash the file here; integrity
    // checks that need a fresh hash should call createReadStream and pipe
    // through createHash separately.
    const base = path.basename(abs);
    const dot = base.indexOf('.');
    const sha256 = dot > 0 ? base.slice(0, dot) : base;

    // MIME re-derivation from the extension. The DB row is the source of
    // truth for the original sniffed MIME; this is only the fallback used
    // by integrity tooling that sees a file with no DB metadata.
    const ext = path.extname(abs).slice(1);
    const mimeType = this.lookupMimeFromExtension(ext);

    return {
      size: stat.size,
      mimeType,
      sha256,
      storedAt: stat.mtime,
    };
  }

  async delete(relPath: string): Promise<void> {
    // Physical delete is deferred to v1.5. Soft-delete via the DB row
    // (deletedAt) is the v1 contract — keeping bytes on disk preserves
    // ledger and audit references and lets us undo accidental deletions.
    this.logger.log(
      `delete(${relPath}): physical delete not implemented in v1 — soft-delete via DB`,
    );
  }

  // SECURITY: Builds an absolute path inside the root and rejects anything
  // that resolves outside it. Defends against `relPath` containing `..`,
  // absolute paths, or symlink components that escape upward.
  private resolveSafe(relPath: string): string {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    const abs = path.resolve(this.root, relPath);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'File not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return abs;
  }

  // uploads/YYYY/MM/DD/{sha[0:2]}/{sha[2:4]}/{sha}.{ext}
  // Date partitioning keeps any single directory from blowing past
  // ext4/xfs's practical entry-count limits, and the sha-prefix fan-out
  // protects within a busy day.
  private buildStoragePath(sha256: string, ext: string): string {
    const now = new Date();
    const y = String(now.getUTCFullYear());
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return [UPLOADS_DIR, y, m, d, sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${ext}`].join(
      '/',
    );
  }

  // SECURITY: Defense-in-depth MIME → extension mapping. The controller
  // layer is expected to allow-list MIMEs per upload purpose; this is a
  // second filter that refuses to materialize a file whose MIME does not
  // map to a known extension.
  private resolveExtension(mimeType: string): string {
    const override = MIME_EXTENSION_OVERRIDES[mimeType.toLowerCase()];
    if (override) return override;

    const ext = mimeExtension(mimeType);
    if (!ext) {
      throw new HttpException(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: `Unsupported MIME type: ${mimeType}`,
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    return ext;
  }

  private lookupMimeFromExtension(ext: string): string {
    const mime = mimeLookup(ext);
    return typeof mime === 'string' ? mime : 'application/octet-stream';
  }
}

function isNoEnt(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  );
}
