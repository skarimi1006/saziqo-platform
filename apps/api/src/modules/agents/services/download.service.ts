import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AgentsPurchaseStatus } from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { FilesService, type FileDownloadStream } from '../../../core/files/files.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface BundleDownload {
  stream: FileDownloadStream['stream'];
  mimeType: string;
  size: bigint;
  filenameHint: string;
  originalName: string;
}

// CLAUDE: The bundle file's owner is the maker, but the buyer is the
// download caller — so the file-level owner check would reject every
// legitimate download. We re-validate ownership here at the listing
// level (any non-refunded purchase) and then ask FilesService to skip
// its own owner check for this read. The agents module is the trusted
// caller; the file-level check stays the default for direct
// /api/v1/files/:id/download access.
@Injectable()
export class DownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async streamBundleForOwner(userId: bigint, listingId: bigint): Promise<BundleDownload> {
    // Refunded purchases revoke download access — only COMPLETED rows
    // grant ownership.
    const ownership = await this.prisma.agents_purchase.findFirst({
      where: {
        userId,
        listingId,
        status: AgentsPurchaseStatus.COMPLETED,
      },
      select: { id: true },
    });
    if (!ownership) {
      throw new HttpException(
        {
          code: ErrorCode.ACCESS_DENIED_NOT_OWNER,
          message: 'You do not own this listing',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const listing = await this.prisma.agents_listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: { id: true, slug: true, bundleFileId: true },
    });
    if (!listing) {
      throw new HttpException(
        { code: ErrorCode.LISTING_NOT_FOUND, message: 'Listing not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (listing.bundleFileId === null) {
      throw new HttpException(
        {
          code: ErrorCode.BUNDLE_NOT_AVAILABLE,
          message: 'This listing does not have a downloadable bundle',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const file = await this.files.streamForDownload(listing.bundleFileId, userId, true);

    return {
      stream: file.stream,
      mimeType: file.mimeType,
      size: file.size,
      originalName: file.originalName,
      filenameHint: `${listing.slug}.zip`,
    };
  }
}
