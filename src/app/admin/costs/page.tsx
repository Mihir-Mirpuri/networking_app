import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import { CostDashboard } from '@/components/admin/CostDashboard';

export default async function AdminCostsPage() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-surface-900 mb-6">API Cost Tracking</h1>
        <CostDashboard />
      </div>
    </div>
  );
}
