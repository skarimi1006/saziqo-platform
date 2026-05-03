import type { Metadata } from 'next';
import { Vazirmatn } from 'next/font/google';

import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic'],
  variable: '--font-vazirmatn',
});

export const metadata: Metadata = {
  title: 'سازیکو',
  description: 'پلتفرم ساخت کسب‌وکار با هوش مصنوعی',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className={vazirmatn.className}>{children}</body>
    </html>
  );
}
