import { SetMetadata } from '@nestjs/common';

export const MAX_UPLOAD_SIZE_KEY = 'upload:maxSizeMb';

// Per-route override for the upload size limit, e.g.
//   @MaxUploadSize(50)  // 50 MB cap for this handler
// Modules use this to raise (or lower) the cap from the global default
// without relaxing the cap on every other endpoint.
export const MaxUploadSize = (megabytes: number): MethodDecorator =>
  SetMetadata(MAX_UPLOAD_SIZE_KEY, megabytes);
