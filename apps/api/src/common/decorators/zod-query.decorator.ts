import { Query } from '@nestjs/common';
import { ZodSchema } from 'zod';

import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

// Usage: handler(@ZodQuery(MySchema) query: z.infer<typeof MySchema>)
export function ZodQuery<T extends ZodSchema>(schema: T): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}
