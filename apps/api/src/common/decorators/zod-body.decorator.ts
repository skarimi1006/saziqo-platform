import { Body } from '@nestjs/common';
import { ZodSchema } from 'zod';

import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

// Usage: handler(@ZodBody(MySchema) body: z.infer<typeof MySchema>)
export function ZodBody<T extends ZodSchema>(schema: T): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}
