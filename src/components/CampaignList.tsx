'use client';

import Link from 'next/link';
import { Campaign, CampaignStatus } from '@prisma/client';
import { deleteCampaign } from '@/app/actions/campaign';
import { useState } from 'react';

type CampaignWithCount = Campaign & {
  _count: { candidates: number };
};

const statusColors: Record<CampaignStatus, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  DISCOVERING: 'bg-blue-100 text-blue-700',
  DISCOVERED: 'bg-blue-100 text-blue-700',
  ENRICHING: 'bg-yellow-100 text-yellow-700',
  READY: 'bg-green-100 text-green-700',
  ERROR: 'bg-red-100 text-red-700',
};

const statusLabels: Record<CampaignStatus, string> = {
  CREATED: 'Created',
  DISCOVERING: 'Discovering...',
  DISCOVERED: 'Discovered',
  ENRICHING: 'Enriching...',
  READY: 'Ready',
  ERROR: 'Error',
};

export function CampaignList({ campaigns }: { campaigns: CampaignWithCount[] }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete campaign "${name}" and all its candidate data?`)) {
      return;
    }
    setDeletingId(id);
    try {
      await deleteCampaign(id);
    } finally {
      setDeletingId(null);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <p className="text-gray-500">No campaigns yet. Create your first one!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              School
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Company
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Candidates
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap">
                <Link
                  href={`/campaign/${campaign.id}`}
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  {campaign.name}
                </Link>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {campaign.school}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {campaign.company}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {campaign._count.candidates}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    statusColors[campaign.status]
                  }`}
                >
                  {statusLabels[campaign.status]}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <button
                  onClick={() => handleDelete(campaign.id, campaign.name)}
                  disabled={deletingId === campaign.id}
                  className="text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {deletingId === campaign.id ? 'Deleting...' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
