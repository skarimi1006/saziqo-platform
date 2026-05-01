import { Global, Module } from '@nestjs/common';

import { FILE_STORE } from './file-store.interface';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalFileStore } from './local-file-store';
import { UploadInterceptor } from './upload.interceptor';

// CLAUDE: FilesModule binds the FILE_STORE token to the local-disk
// implementation. To swap to S3 (or another backend) in v1.5, change the
// useClass here — every consumer injects via @Inject(FILE_STORE) and is
// agnostic to the storage tier.
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    LocalFileStore,
    FilesService,
    UploadInterceptor,
    {
      provide: FILE_STORE,
      useExisting: LocalFileStore,
    },
  ],
  exports: [FILE_STORE, LocalFileStore, FilesService],
})
export class FilesModule {}
