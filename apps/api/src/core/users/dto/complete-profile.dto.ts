import { z } from 'zod';

// Persian Unicode block U+0600..U+06FF plus whitespace — used for
// firstName/lastName so users cannot store Latin or mixed-script names.
const PERSIAN_NAME_REGEX = /^[؀-ۿ\s]+$/;

// CLAUDE: Placeholder Iranian national ID validator — currently just
// checks the 10-digit shape. Phase 3C replaces the body with the real
// checksum algorithm (sum_{i=0..8} digit[i] * (10 - i) mod 11; if
// remainder < 2 then last digit must equal remainder, else 11 - remainder).
// Keep the function name stable so Phase 3C is a one-line body swap.
function isValidIranianNationalId(value: string): boolean {
  return /^\d{10}$/.test(value);
}

export const CompleteProfileSchema = z
  .object({
    firstName: z
      .string()
      .min(1, 'First name is required')
      .max(80, 'First name too long')
      .regex(PERSIAN_NAME_REGEX, 'First name must contain only Persian characters'),
    lastName: z
      .string()
      .min(1, 'Last name is required')
      .max(120, 'Last name too long')
      .regex(PERSIAN_NAME_REGEX, 'Last name must contain only Persian characters'),
    nationalId: z.string().refine(isValidIranianNationalId, {
      message: 'National ID must be a valid Iranian 10-digit ID',
    }),
    email: z.string().email('Invalid email format').max(255),
  })
  .strict();

export type CompleteProfileDto = z.infer<typeof CompleteProfileSchema>;
