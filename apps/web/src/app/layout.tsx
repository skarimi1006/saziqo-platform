import type { Metadata } from 'next';

import { vazirmatn } from './fonts';
import './globals.css';

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
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
