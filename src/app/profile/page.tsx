import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { Header } from '@/components/Header';
import { ProfileClient } from '@/components/profile/ProfileClient';

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/auth/signin');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ProfileClient
          userEmail={session.user.email || ''}
          userName={session.user.name || ''}
          userImage={session.user.image || ''}
        />
      </main>
    </div>
  );
}
