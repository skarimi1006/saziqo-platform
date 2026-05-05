import type { Metadata } from 'next';

import { AuthLayoutClient } from '@/components/auth/auth-layout-client';

export const metadata: Metadata = {
  title: 'ورود به سازیکو',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayoutClient>{children}</AuthLayoutClient>;
}
