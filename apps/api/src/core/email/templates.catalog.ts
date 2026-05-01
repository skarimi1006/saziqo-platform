export interface EmailTemplate {
  subject: string;
  textBody: (vars: Record<string, unknown>) => string;
  // htmlBody deferred to v1.5
}

export const EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  welcome: {
    subject: 'به سازیکو خوش آمدید',
    textBody: (v) =>
      `سلام ${String(v['firstName'])} عزیز،\n\nبه سازیکو خوش آمدید! حساب شما با موفقیت ایجاد شد.\n\nتیم سازیکو`,
  },

  payment_succeeded: {
    subject: 'پرداخت شما تأیید شد',
    textBody: (v) =>
      `پرداخت شما به مبلغ ${String(v['amount'])} تومان با موفقیت تأیید شد.\nشماره پیگیری: ${String(v['reference'])}`,
  },

  payment_failed: {
    subject: 'پرداخت ناموفق',
    textBody: (v) =>
      `پرداخت به مبلغ ${String(v['amount'])} تومان ناموفق بود.\nلطفاً مجدداً تلاش کنید یا با پشتیبانی تماس بگیرید.`,
  },

  profile_completed: {
    subject: 'پروفایل شما تکمیل شد',
    textBody: (v) =>
      `سلام ${String(v['firstName'])} عزیز،\n\nپروفایل شما با موفقیت تکمیل شد. اکنون می‌توانید از تمام امکانات سازیکو استفاده کنید.\n\nتیم سازیکو`,
  },

  payout_approved: {
    subject: 'تسویه حساب تأیید شد',
    textBody: (v) =>
      `درخواست تسویه شما به مبلغ ${String(v['amount'])} تومان تأیید شد و به‌زودی به حساب بانکی شما واریز می‌شود.`,
  },
};
