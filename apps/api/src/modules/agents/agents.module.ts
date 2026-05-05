import { Module } from '@nestjs/common';

import { CategoriesBootstrapService } from './services/categories.bootstrap';
import { SettingsBootstrapService } from './services/settings.bootstrap';

@Module({
  providers: [SettingsBootstrapService, CategoriesBootstrapService],
})
export class AgentsModule {}
