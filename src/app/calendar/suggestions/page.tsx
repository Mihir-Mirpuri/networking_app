import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NewHeader } from '@/components/layout/NewHeader';
import { SuggestionsClient } from './SuggestionsClient';

export default async function SuggestionsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NewHeader />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SuggestionsClient />
      </main>
    </div>
  );
}
