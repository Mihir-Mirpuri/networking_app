import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ProfileLayout } from '@/components/profile/ProfileLayout';

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/');
  }

  return (
    <ProfileLayout
      userEmail={session.user.email || ''}
      userName={session.user.name || ''}
      userImage={session.user.image || ''}
    />
  );
}
