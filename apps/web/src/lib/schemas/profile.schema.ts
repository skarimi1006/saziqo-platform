import { isValidIranianNationalId } from '@saziqo/persian-utils';
import { z } from 'zod';

const PERSIAN_NAME_REGEX = /^[؀-ۿ\s]+$/;

export const profileSchema = z.object({
  firstName: z
    .string()
    .min(2, 'حداقل ۲ کاراکتر')
    .max(80, 'حداکثر ۸۰ کاراکتر')
    .regex(PERSIAN_NAME_REGEX, 'فقط فارسی'),
  lastName: z
    .string()
    .min(2, 'حداقل ۲ کاراکتر')
    .max(120, 'حداکثر ۱۲۰ کاراکتر')
    .regex(PERSIAN_NAME_REGEX, 'فقط فارسی'),
  nationalId: z
    .string()
    .length(10, 'کد ملی باید ۱۰ رقم باشد')
    .refine(isValidIranianNationalId, 'کد ملی نامعتبر'),
  email: z.string().email('ایمیل نامعتبر').max(255, 'ایمیل طولانی است'),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
