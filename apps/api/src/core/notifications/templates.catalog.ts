import { formatToman } from './format';

export interface NotificationTemplate {
  inApp?: { title: string; body: (vars: Record<string, unknown>) => string };
  sms?: (vars: Record<string, unknown>) => string;
  email?: { subject: string; textBody: (vars: Record<string, unknown>) => string };
}

// Safely converts numeric payload values (bigint, number, or stringified number)
// to a formatted toman string with thousand separators.
function amt(v: unknown): string {
  if (typeof v === 'bigint') return formatToman(v);
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? formatToman(BigInt(n)) : String(v);
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  OTP_SENT: {
    sms: (v) => `کد تایید سازیکو: ${String(v['code'])}\nاین کد تا ۲ دقیقه معتبر است.`,
  },

  PROFILE_COMPLETED: {
    inApp: {
      title: 'پروفایل تکمیل شد',
      body: () => 'حساب شما کامل شد. اکنون می‌توانید از همه امکانات استفاده کنید.',
    },
  },

  SESSION_REVOKED: {
    inApp: {
      title: 'یکی از نشست‌های شما لغو شد',
      body: (v) => `نشست از دستگاه ${String(v['userAgent'] ?? 'ناشناس')} لغو شد.`,
    },
  },

  IMPERSONATION_NOTICE: {
    inApp: {
      title: 'دسترسی پشتیبانی به حساب',
      body: (v) =>
        `پشتیبانی سازیکو در تاریخ ${String(v['startedAt'])} برای ${String(v['durationMinutes'])} دقیقه به حساب شما دسترسی داشت. دلیل: ${String(v['reason'])}`,
    },
  },

  PAYMENT_SUCCEEDED: {
    inApp: {
      title: 'پرداخت موفق',
      body: (v) => `پرداخت ${amt(v['amount'])} تومان با موفقیت تأیید شد.`,
    },
    sms: (v) =>
      `سازیکو: پرداخت ${amt(v['amount'])} تومان تأیید شد. کد پیگیری: ${String(v['reference'] ?? '')}`,
  },

  PAYMENT_FAILED: {
    inApp: {
      title: 'پرداخت ناموفق',
      body: (v) => `پرداخت ${amt(v['amount'])} تومان ناموفق بود. لطفاً مجدداً تلاش کنید.`,
    },
  },

  PAYMENT_CANCELLED: {
    inApp: {
      title: 'پرداخت لغو شد',
      body: () => 'پرداخت توسط شما لغو شد.',
    },
  },

  WALLET_CREDITED: {
    inApp: {
      title: 'افزایش موجودی',
      body: (v) =>
        `${amt(v['amount'])} تومان به کیف پول شما واریز شد. موجودی فعلی: ${amt(v['balance'])} تومان`,
    },
  },

  WALLET_DEBITED: {
    inApp: {
      title: 'کاهش موجودی',
      body: (v) => `${amt(v['amount'])} تومان از کیف پول شما برداشت شد.`,
    },
  },

  PAYOUT_REQUESTED: {
    inApp: {
      title: 'درخواست تسویه ثبت شد',
      body: (v) => `درخواست تسویه ${amt(v['amount'])} تومان ثبت شد و در صف بررسی است.`,
    },
  },

  PAYOUT_APPROVED: {
    inApp: {
      title: 'تسویه تأیید شد',
      body: (v) => `تسویه ${amt(v['amount'])} تومان تأیید شد.`,
    },
  },

  PAYOUT_REJECTED: {
    inApp: {
      title: 'تسویه رد شد',
      body: (v) => `درخواست تسویه ${amt(v['amount'])} تومان رد شد. دلیل: ${String(v['reason'])}`,
    },
  },

  PAYOUT_PAID: {
    inApp: {
      title: 'مبلغ تسویه واریز شد',
      body: (v) =>
        `مبلغ ${amt(v['amount'])} تومان به حساب بانکی شما واریز شد. شماره پیگیری: ${String(v['paymentReference'])}`,
    },
  },
};
