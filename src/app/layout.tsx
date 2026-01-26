import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AuthenticatedComposeButton } from '@/components/compose/AuthenticatedComposeButton';
import { FeedbackButton } from '@/components/feedback/FeedbackButton';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Lattice',
  description: 'Finance/consulting recruiting outreach tool',
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
          <AuthenticatedComposeButton />
          <FeedbackButton />
        </Providers>
      </body>
    </html>
  );
}
