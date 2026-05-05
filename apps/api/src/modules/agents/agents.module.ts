import { Module } from '@nestjs/common';

import { AgentsCartAdapterService } from './services/cart-adapter.service';
import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  providers: [SettingsBootstrapService, CategoriesBootstrapService, AgentsCartAdapterService],
})
export class AgentsModule {}
