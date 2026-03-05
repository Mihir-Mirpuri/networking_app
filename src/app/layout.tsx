import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';
import { Providers } from '@/components/Providers';
import { FeedbackButton } from '@/components/feedback/FeedbackButton';

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
      <body className={GeistSans.className}>
        <Providers>
          {children}
          <FeedbackButton />
        </Providers>
      </body>
    </html>
  );
}
