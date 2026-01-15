'use client';

import { useState } from 'react';
import { Campaign, Candidate, EmailStatus, SendStatus, SourceLink, EmailDraft, SendLog } from '@prisma/client';
import { CandidateRow } from './CandidateRow';
import { sendEmails } from '@/app/actions/send';
import { useRouter } from 'next/navigation';

type CandidateWithRelations = Candidate & {
  sourceLinks: SourceLink[];
  emailDraft: EmailDraft | null;
  sendLogs: SendLog[];
};

interface CandidateTableProps {
  campaign: Campaign;
  candidates: CandidateWithRelations[];
  remainingDaily: number;
}

export function CandidateTable({ campaign, candidates, remainingDaily }: CandidateTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState<Record<string, 'success' | 'failed' | 'pending'>>({});
  const router = useRouter();

  const canSend = (candidate: CandidateWithRelations) => {
    if (candidate.sendStatus === 'SENT') return false;
    if (candidate.emailStatus === 'VERIFIED') return true;
    if (candidate.emailStatus === 'MANUAL' && candidate.manualEmailConfirmed) return true;
    return false;
  };

  const sendableCount = candidates.filter(canSend).length;
  const selectedSendable = Array.from(selected).filter((id) => {
    const c = candidates.find((c) => c.id === id);
    return c && canSend(c);
  });

  const handleSelectAll = () => {
    if (selected.size === sendableCount) {
      setSelected(new Set());
    } else {
      const sendableIds = candidates.filter(canSend).map((c) => c.id);
      setSelected(new Set(sendableIds));
    }
  };

  const handleToggle = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const handleSend = async () => {
    if (selectedSendable.length === 0) {
      alert('No sendable candidates selected');
      return;
    }

    const toSend = selectedSendable.slice(0, 10);
    if (toSend.length > remainingDaily) {
      alert(`You can only send ${remainingDaily} more emails today (daily limit: 30)`);
      return;
    }

    const confirmed = confirm(
      `Send ${toSend.length} email(s)? This will use ${toSend.length} of your ${remainingDaily} remaining daily sends.`
    );
    if (!confirmed) return;

    setIsSending(true);
    const pending: Record<string, 'pending'> = {};
    toSend.forEach((id) => (pending[id] = 'pending'));
    setSendResults(pending);

    try {
      const results = await sendEmails(campaign.id, toSend);
      const newResults: Record<string, 'success' | 'failed'> = {};
      results.forEach((r) => {
        newResults[r.candidateId] = r.success ? 'success' : 'failed';
      });
      setSendResults(newResults);

      // Remove successfully sent from selection
      const newSelected = new Set(selected);
      results.filter((r) => r.success).forEach((r) => newSelected.delete(r.candidateId));
      setSelected(newSelected);

      router.refresh();
    } catch (error) {
      console.error('Send failed:', error);
      alert('Failed to send emails');
    } finally {
      setIsSending(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
        <p className="text-gray-500">
          {campaign.status === 'DISCOVERING'
            ? 'Discovering candidates...'
            : 'No candidates found. Try adjusting your search keywords.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {candidates.length} candidates | {selected.size} selected
          </span>
          <span className="text-sm text-gray-500">
            Daily sends remaining: {remainingDaily}/30
          </span>
        </div>
        <button
          onClick={handleSend}
          disabled={isSending || selectedSendable.length === 0}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {isSending
            ? 'Sending...'
            : `Send Selected (${Math.min(selectedSendable.length, 10, remainingDaily)})`}
        </button>
      </div>

      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left">
              <input
                type="checkbox"
                checked={selected.size === sendableCount && sendableCount > 0}
                onChange={handleSelectAll}
                className="rounded border-gray-300"
              />
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Role
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Email
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Links
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              campaign={campaign}
              isSelected={selected.has(candidate.id)}
              onToggle={() => handleToggle(candidate.id)}
              canSend={canSend(candidate)}
              sendResult={sendResults[candidate.id]}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
