'use client';

import Link from 'next/link';
import { Campaign, CampaignStatus } from '@prisma/client';
import { startEnrichment } from '@/app/actions/campaign';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
  DISCOVERING: 'Discovering candidates...',
  DISCOVERED: 'Discovery complete',
  ENRICHING: 'Enriching emails...',
  READY: 'Ready to send',
  ERROR: 'Error',
};

interface CampaignHeaderProps {
  campaign: Campaign & { _count?: { candidates: number } };
}

export function CampaignHeader({ campaign }: CampaignHeaderProps) {
  const [isEnriching, setIsEnriching] = useState(false);
  const [status, setStatus] = useState(campaign.status);
  const [progress, setProgress] = useState(
    campaign.status === 'DISCOVERING' ? campaign.discoveryProgress : campaign.enrichmentProgress
  );
  const router = useRouter();

  // Poll for status updates when processing
  useEffect(() => {
    const isProcessing = status === 'DISCOVERING' || status === 'ENRICHING';
    if (!isProcessing) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaign/${campaign.id}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatus(data.status);
          setProgress(
            data.status === 'DISCOVERING' ? data.discoveryProgress : data.enrichmentProgress
          );
          if (data.status !== 'DISCOVERING' && data.status !== 'ENRICHING') {
            router.refresh();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [campaign.id, status, router]);

  const handleEnrich = async () => {
    setIsEnriching(true);
    try {
      await startEnrichment(campaign.id);
      router.refresh();
    } catch (error) {
      console.error('Failed to start enrichment:', error);
      alert('Failed to start enrichment');
    } finally {
      setIsEnriching(false);
    }
  };

  const isProcessing = status === 'DISCOVERING' || status === 'ENRICHING';

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href="/" className="text-gray-400 hover:text-gray-600">
              &larr; Back
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
            <span>School: <strong>{campaign.school}</strong></span>
            <span>Company: <strong>{campaign.company}</strong></span>
            <span>Keywords: <strong>{campaign.roleKeywords.join(', ')}</strong></span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[status]}`}>
            {statusLabels[status]}
          </span>
          {status === 'DISCOVERED' && (
            <button
              onClick={handleEnrich}
              disabled={isEnriching}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {isEnriching ? 'Starting...' : 'Enrich Emails'}
            </button>
          )}
        </div>
      </div>
      {isProcessing && (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <span>Progress:</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
