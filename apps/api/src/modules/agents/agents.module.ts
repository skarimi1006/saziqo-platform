import { Module } from '@nestjs/common';

import { NotificationsModule } from '../../core/notifications/notifications.module';

import { CatalogController } from './controllers/catalog.controller';
import { AgentsCartAdapterService } from './services/cart-adapter.service';
import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { ListingsService } from './services/listings.service';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  imports: [NotificationsModule],
  controllers: [CatalogController],
  providers: [
    SettingsBootstrapService,
    CategoriesBootstrapService,
    AgentsCartAdapterService,
    ListingsService,
  ],
  exports: [ListingsService],
})
export class AgentsModule {}
