import { Module } from '@nestjs/common';

import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { NotificationsModule } from '../../core/notifications/notifications.module';

import { AgentsCartController } from './controllers/cart.controller';
import { CatalogController } from './controllers/catalog.controller';
import { CategoriesController } from './controllers/categories.controller';
import { AgentsCheckoutController } from './controllers/checkout.controller';
import { AgentsDownloadController } from './controllers/download.controller';
import { AgentsLibraryController } from './controllers/library.controller';
import { ListingsController } from './controllers/listings.controller';
import { MakerListingsController } from './controllers/maker-listings.controller';
import { AgentsReviewsController } from './controllers/reviews.controller';
import { AgentsRunsController } from './controllers/runs.controller';
import { SearchController } from './controllers/search.controller';
import { SectionsController } from './controllers/sections.controller';
import { AgentsCartAdapterService } from './services/cart-adapter.service';
import { CartService } from './services/cart.service';
import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { CategoriesService } from './services/categories.service';
import { CheckoutService } from './services/checkout.service';
import { DownloadService } from './services/download.service';
import { LibraryService } from './services/library.service';
import { ListingsService } from './services/listings.service';
import { ReviewsService } from './services/reviews.service';
import { RunsService } from './services/runs.service';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  imports: [NotificationsModule],
  controllers: [
    AgentsCartController,
    AgentsCheckoutController,
    AgentsDownloadController,
    AgentsLibraryController,
    AgentsReviewsController,
    AgentsRunsController,
    CatalogController,
    CategoriesController,
    ListingsController,
    MakerListingsController,
    SearchController,
    SectionsController,
  ],
  providers: [
    SettingsBootstrapService,
    CategoriesBootstrapService,
    AgentsCartAdapterService,
    CartService,
    CategoriesService,
    CheckoutService,
    DownloadService,
    LibraryService,
    ListingsService,
    ReviewsService,
    RunsService,
    OptionalJwtAuthGuard,
  ],
  exports: [
    ListingsService,
    CategoriesService,
    CartService,
    CheckoutService,
    DownloadService,
    LibraryService,
    ReviewsService,
    RunsService,
  ],
})
export class AgentsModule {}
