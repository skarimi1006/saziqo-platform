import { Controller, Get } from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import { CategoriesService, type CategoryPublicDto } from '../services/categories.service';

@Controller('agents')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get('categories')
  @Public()
  async getCategories(): Promise<{ data: CategoryPublicDto[] }> {
    const data = await this.categoriesService.findAllPublic();
    return { data };
  }
}
