import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { Outfit } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { EmbeddedBrowserWarning } from '@/components/EmbeddedBrowserWarning';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://signl.to'),
  title: 'Signl',
  description: 'Finance/consulting recruiting outreach tool',
  alternates: {
    canonical: './',
  },
};

async function getTheme(): Promise<'free' | 'pro'> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return 'free';

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subscriptionStatus: true, stripeCurrentPeriodEnd: true, accessExpiresAt: true },
    });

    const now = new Date();
    const hasRecurring = user?.subscriptionStatus === 'active' && user?.stripeCurrentPeriodEnd && user.stripeCurrentPeriodEnd > now;
    const hasUpfront = user?.accessExpiresAt && user.accessExpiresAt > now;

    return (hasRecurring || hasUpfront) ? 'pro' : 'free';
  } catch {
    return 'free';
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getTheme();

  return (
    <html lang="en">
      <body className={`${GeistSans.className} ${outfit.variable}`} data-theme={theme}>
        <Providers>
          <EmbeddedBrowserWarning />
          {children}
        </Providers>
      </body>
    </html>
  );
}
