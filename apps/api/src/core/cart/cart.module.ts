import { Global, Module } from '@nestjs/common';

import { CartAggregatorService } from './cart-aggregator.service';

@Global()
@Module({
  providers: [CartAggregatorService],
  exports: [CartAggregatorService],
})
export class CartModule {}
