import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { FeedbackButton } from '@/components/feedback/FeedbackButton';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://signl.to'),
  title: 'Signl',
  description: 'Finance/consulting recruiting outreach tool',
  alternates: {
    canonical: './',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <FeedbackButton />
        </Providers>
      </body>
    </html>
  );
}
