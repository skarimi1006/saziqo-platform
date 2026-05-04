import type { Metadata } from 'next';

import { vazirmatn } from './fonts';

import { AuthBootstrap } from '@/components/auth/auth-bootstrap';
import { ImpersonationBanner } from '@/components/impersonation/impersonation-banner';
import { Providers } from '@/components/providers';

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
      <body className="font-sans antialiased">
        <Providers>
          <ImpersonationBanner />
          <AuthBootstrap>{children}</AuthBootstrap>
        </Providers>
      </body>
    </html>
  );
}
