import { Module } from '@nestjs/common';

import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { NotificationsModule } from '../../core/notifications/notifications.module';

import { CatalogController } from './controllers/catalog.controller';
import { ListingsController } from './controllers/listings.controller';
import { SectionsController } from './controllers/sections.controller';
import { AgentsCartAdapterService } from './services/cart-adapter.service';
import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { ListingsService } from './services/listings.service';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  imports: [NotificationsModule],
  controllers: [CatalogController, ListingsController, SectionsController],
  providers: [
    SettingsBootstrapService,
    CategoriesBootstrapService,
    AgentsCartAdapterService,
    ListingsService,
    OptionalJwtAuthGuard,
  ],
  exports: [ListingsService],
})
export class AgentsModule {}
