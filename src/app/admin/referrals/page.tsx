import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import prisma from '@/lib/prisma';
import { CreateLinkForm } from './CreateLinkForm';

export default async function AdminReferralsPage() {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    redirect('/');
  }

  const links = await prisma.referralLink.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { id: true, name: true, email: true } },
      signups: {
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          subscriptionStatus: true,
        },
      },
    },
  });

  const totals = {
    clicks: links.reduce((s, l) => s + l.clickCount, 0),
    signups: links.reduce((s, l) => s + l.signupCount, 0),
    paid: links.reduce((s, l) => s + l.paidCount, 0),
  };

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-surface-900 mb-6">Referral Tracking</h1>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Total Clicks</p>
            <p className="text-3xl font-bold text-surface-900">{totals.clicks}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Total Signups</p>
            <p className="text-3xl font-bold text-surface-900">{totals.signups}</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-200 p-5">
            <p className="text-sm text-surface-500">Paid Conversions</p>
            <p className="text-3xl font-bold text-surface-900">{totals.paid}</p>
          </div>
        </div>

        {/* Links table */}
        <div className="bg-white rounded-xl border border-surface-200 overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-50 border-b border-surface-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Code</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Label</th>
                  <th className="text-left px-4 py-3 font-medium text-surface-600">Ambassador</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Clicks</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Signups</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Paid</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Click→Signup</th>
                  <th className="text-right px-4 py-3 font-medium text-surface-600">Signup→Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {links.map((link) => (
                  <tr key={link.id} className="hover:bg-surface-50">
                    <td className="px-4 py-3 font-mono text-xs">{link.code}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        link.type === 'AMBASSADOR'
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-teal-100 text-teal-700'
                      }`}>
                        {link.type === 'AMBASSADOR' ? 'Ambassador' : 'QR Code'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-surface-700">{link.label}</td>
                    <td className="px-4 py-3 text-surface-500">
                      {link.user?.name || link.user?.email || '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{link.clickCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{link.signupCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{link.paidCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-500">
                      {link.clickCount > 0
                        ? ((link.signupCount / link.clickCount) * 100).toFixed(1) + '%'
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-500">
                      {link.signupCount > 0
                        ? ((link.paidCount / link.signupCount) * 100).toFixed(1) + '%'
                        : '—'}
                    </td>
                  </tr>
                ))}
                {links.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-surface-400">
                      No referral links yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Per-link signups detail */}
        {links.filter((l) => l.signups.length > 0).map((link) => (
          <div key={link.id} className="bg-white rounded-xl border border-surface-200 p-5 mb-4">
            <h3 className="font-semibold text-surface-900 mb-3">
              {link.label} <span className="font-mono text-xs text-surface-400">({link.code})</span>
            </h3>
            <div className="space-y-2">
              {link.signups.map((u) => (
                <div key={u.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-surface-800">{u.name || 'Unknown'}</span>
                    <span className="text-surface-400 ml-2">{u.email}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-surface-400 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      u.subscriptionStatus === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-surface-100 text-surface-500'
                    }`}>
                      {u.subscriptionStatus === 'active' ? 'Paid' : 'Free'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Create link form */}
        <CreateLinkForm />
      </div>
    </div>
  );
}
