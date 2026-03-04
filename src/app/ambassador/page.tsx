import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { Header } from '@/components/Header';
import { CopyLinkButton } from './CopyLinkButton';

export default async function AmbassadorPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/');
  }

  const link = await prisma.referralLink.findFirst({
    where: { userId: session.user.id },
    include: {
      signups: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          subscriptionStatus: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!link) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-surface-900 mb-2">Not an Ambassador</h1>
          <p className="text-surface-500">You don&apos;t have an ambassador referral link yet.</p>
        </div>
      </div>
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'https://signl.to';
  const referralUrl = `${baseUrl}/?ref=${link.code}`;

  const clickToSignup = link.clickCount > 0
    ? ((link.signupCount / link.clickCount) * 100).toFixed(1) + '%'
    : '--';
  const signupToPaid = link.signupCount > 0
    ? ((link.paidCount / link.signupCount) * 100).toFixed(1) + '%'
    : '--';

  return (
    <div className="min-h-screen bg-surface-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-surface-900 mb-6">Your Ambassador Stats</h1>

        {/* Referral link */}
        <div className="bg-white rounded-xl border border-surface-200 p-5 mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-surface-500 mb-1">Your referral link</p>
            <p className="font-mono text-sm text-surface-800 truncate">{referralUrl}</p>
          </div>
          <CopyLinkButton url={referralUrl} />
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Clicks</p>
            <p className="text-3xl font-bold text-surface-900">{link.clickCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Signups</p>
            <p className="text-3xl font-bold text-surface-900">{link.signupCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Paid</p>
            <p className="text-3xl font-bold text-surface-900">{link.paidCount}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Click &rarr; Signup</p>
            <p className="text-2xl font-bold text-surface-900">{clickToSignup}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Signup &rarr; Paid</p>
            <p className="text-2xl font-bold text-surface-900">{signupToPaid}</p>
          </div>
        </div>

        {/* Referred users table */}
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-200">
            <h2 className="font-semibold text-surface-900">Referred Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Signed Up</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {link.signups.map((u) => (
                  <tr key={u.id} className="hover:bg-surface-50">
                    <td className="px-4 py-3 text-surface-800">{u.name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-surface-500">{u.email}</td>
                    <td className="px-4 py-3 text-surface-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        u.subscriptionStatus === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-surface-100 text-surface-500'
                      }`}>
                        {u.subscriptionStatus === 'active' ? 'Paid' : 'Free'}
                      </span>
                    </td>
                  </tr>
                ))}
                {link.signups.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-surface-400">
                      No signups yet — share your link to get started!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
