import { UserStatus } from '@prisma/client';
import { z } from 'zod';

// Admin-only patches. Strict — unknown keys are rejected so an attacker
// cannot smuggle phoneVerifiedAt or totpSecret through the admin endpoint.
export const UpdateUserSchema = z
  .object({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(120).optional(),
    email: z.string().email().max(255).optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .strict();

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
