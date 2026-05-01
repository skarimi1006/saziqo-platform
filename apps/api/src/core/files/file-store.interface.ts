// CLAUDE: FileStore is the abstraction every business module uses to
// persist user uploads. The interface hides whether storage is on the
// local filesystem (v1), S3, or another backend (v1.5+). All callers
// receive a relative `path` from put() and pass it back to get/head/delete
// — they never construct or join absolute paths themselves. This is the
// only safe boundary against path-traversal attacks.
export interface FileStore {
  readonly name: string;

  put(input: PutFileInput): Promise<StoredFile>;
  get(path: string): Promise<NodeJS.ReadableStream>;
  head(path: string): Promise<FileMetadata | null>;
  delete(path: string): Promise<void>;
}

export interface PutFileInput {
  buffer: Buffer;
  // SECURITY: originalName is for display only. The on-disk path is built
  // from the sha256 of the buffer, never from this field, so a malicious
  // name like "../../etc/passwd" cannot escape the storage root.
  originalName: string;
  // SECURITY: The caller is expected to pass the MIME *as sniffed from the
  // bytes*, not the value the client sent in the multipart envelope. The
  // store does another check (extension whitelist) but it is defense in
  // depth — sniffing is the primary safeguard.
  mimeType: string;
  ownerUserId: bigint;
}

export interface StoredFile {
  // Relative storage path under FILE_STORAGE_ROOT (forward slashes).
  // Persist this in the DB; the absolute path is derived at read time.
  path: string;
  sha256: string;
  size: number;
  mimeType: string;
}

export interface FileMetadata {
  size: number;
  mimeType: string;
  sha256: string;
  storedAt: Date;
}

// Injection token. Bind to an implementation class in FilesModule.
export const FILE_STORE = Symbol('FILE_STORE');
