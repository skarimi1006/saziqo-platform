import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema, z } from 'zod';

// CLAUDE: This pipe deliberately does NOT catch ZodError — it lets the
// error bubble to AllExceptionsFilter, which formats validation errors
// uniformly across the API. Do not catch the error here.
@Injectable()
export class ZodValidationPipe<T extends ZodSchema> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<T> {
    return this.schema.parse(value) as z.infer<T>;
  }
}
