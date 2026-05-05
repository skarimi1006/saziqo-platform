import { Module } from '@nestjs/common';

import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { NotificationsModule } from '../../core/notifications/notifications.module';

import { AgentsCartController } from './controllers/cart.controller';
import { CatalogController } from './controllers/catalog.controller';
import { CategoriesController } from './controllers/categories.controller';
import { AgentsCheckoutController } from './controllers/checkout.controller';
import { AgentsLibraryController } from './controllers/library.controller';
import { ListingsController } from './controllers/listings.controller';
import { SearchController } from './controllers/search.controller';
import { SectionsController } from './controllers/sections.controller';
import { AgentsCartAdapterService } from './services/cart-adapter.service';
import { CartService } from './services/cart.service';
import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { CategoriesService } from './services/categories.service';
import { CheckoutService } from './services/checkout.service';
import { LibraryService } from './services/library.service';
import { ListingsService } from './services/listings.service';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  imports: [NotificationsModule],
  controllers: [
    AgentsCartController,
    AgentsCheckoutController,
    AgentsLibraryController,
    CatalogController,
    CategoriesController,
    ListingsController,
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
    LibraryService,
    ListingsService,
    OptionalJwtAuthGuard,
  ],
  exports: [ListingsService, CategoriesService, CartService, CheckoutService, LibraryService],
})
export class AgentsModule {}
