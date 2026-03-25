import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { LandingPage } from '@/components/landing/LandingPage';

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  // Authenticated users go straight to the app
  if (session?.user?.id) {
    redirect('/app');
  }

  return <LandingPage />;
}
