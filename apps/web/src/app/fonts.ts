import localFont from 'next/font/local';

export const vazirmatn = localFont({
  src: [
    {
      path: '../../public/fonts/vazirmatn/Vazirmatn-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    { path: '../../public/fonts/vazirmatn/Vazirmatn-Medium.woff2', weight: '500', style: 'normal' },
    {
      path: '../../public/fonts/vazirmatn/Vazirmatn-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    { path: '../../public/fonts/vazirmatn/Vazirmatn-Bold.woff2', weight: '700', style: 'normal' },
    {
      path: '../../public/fonts/vazirmatn/Vazirmatn-ExtraBold.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
  display: 'swap',
  variable: '--font-vazirmatn',
});
