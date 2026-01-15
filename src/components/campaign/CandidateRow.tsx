'use client';

import { useState } from 'react';
import { Campaign, Candidate, EmailStatus, SourceLink, EmailDraft, SendLog, SourceLinkKind } from '@prisma/client';
import { updateCandidateEmail, updateEmailDraft } from '@/app/actions/candidate';
import { useRouter } from 'next/navigation';

type CandidateWithRelations = Candidate & {
  sourceLinks: SourceLink[];
  emailDraft: EmailDraft | null;
  sendLogs: SendLog[];
};

interface CandidateRowProps {
  candidate: CandidateWithRelations;
  campaign: Campaign;
  isSelected: boolean;
  onToggle: () => void;
  canSend: boolean;
  sendResult?: 'success' | 'failed' | 'pending';
}

const emailStatusBadge: Record<EmailStatus, { label: string; color: string }> = {
  MISSING: { label: 'MISSING', color: 'bg-gray-100 text-gray-600' },
  UNVERIFIED: { label: 'UNVERIFIED', color: 'bg-yellow-100 text-yellow-700' },
  VERIFIED: { label: 'VERIFIED', color: 'bg-green-100 text-green-700' },
  MANUAL: { label: 'MANUAL', color: 'bg-blue-100 text-blue-700' },
};

export function CandidateRow({
  candidate,
  campaign,
  isSelected,
  onToggle,
  canSend,
  sendResult,
}: CandidateRowProps) {
  const [showEmailEditor, setShowEmailEditor] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const [manualEmail, setManualEmail] = useState(candidate.email || '');
  const [manualConfirmed, setManualConfirmed] = useState(candidate.manualEmailConfirmed);
  const [draftSubject, setDraftSubject] = useState(candidate.emailDraft?.subject || '');
  const [draftBody, setDraftBody] = useState(candidate.emailDraft?.body || '');
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  const discoveryLinks = candidate.sourceLinks.filter((l) => l.kind === 'DISCOVERY');
  const researchLinks = candidate.sourceLinks.filter((l) => l.kind === 'RESEARCH');

  const handleSaveEmail = async () => {
    setIsSaving(true);
    try {
      await updateCandidateEmail(candidate.id, manualEmail, manualConfirmed);
      router.refresh();
    } catch (error) {
      console.error('Failed to save email:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      await updateEmailDraft(candidate.id, draftSubject, draftBody);
      setShowEmailEditor(false);
      router.refresh();
    } catch (error) {
      console.error('Failed to save draft:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const rowBg =
    sendResult === 'success'
      ? 'bg-green-50'
      : sendResult === 'failed'
      ? 'bg-red-50'
      : sendResult === 'pending'
      ? 'bg-yellow-50'
      : candidate.sendStatus === 'SENT'
      ? 'bg-gray-50'
      : '';

  return (
    <>
      <tr className={`hover:bg-gray-50 ${rowBg}`}>
        <td className="px-4 py-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            disabled={!canSend || candidate.sendStatus === 'SENT'}
            className="rounded border-gray-300 disabled:opacity-50"
          />
        </td>
        <td className="px-4 py-3">
          <div className="font-medium text-gray-900">{candidate.fullName}</div>
          <div className="text-sm text-gray-500">{candidate.company}</div>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">
          {candidate.role || '-'}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {candidate.email ? (
              <span className="text-sm text-gray-900">{candidate.email}</span>
            ) : (
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="Enter email..."
                className="text-sm px-2 py-1 border border-gray-300 rounded w-48"
              />
            )}
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                emailStatusBadge[candidate.emailStatus].color
              }`}
            >
              {emailStatusBadge[candidate.emailStatus].label}
            </span>
          </div>
          {(candidate.emailStatus === 'MISSING' || candidate.emailStatus === 'MANUAL') && (
            <div className="mt-2 flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={manualConfirmed}
                  onChange={(e) => setManualConfirmed(e.target.checked)}
                  className="rounded border-gray-300"
                />
                I confirm this email is correct
              </label>
              {(manualEmail !== candidate.email || manualConfirmed !== candidate.manualEmailConfirmed) && (
                <button
                  onClick={handleSaveEmail}
                  disabled={isSaving}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          {candidate.sendStatus === 'SENT' ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              SENT
            </span>
          ) : candidate.sendStatus === 'FAILED' ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
              FAILED
            </span>
          ) : sendResult === 'pending' ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
              SENDING...
            </span>
          ) : (
            <span className="text-xs text-gray-500">Not sent</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <div className="relative">
              <button
                onClick={() => {
                  setShowSources(!showSources);
                  setShowResearch(false);
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Sources ({discoveryLinks.length})
              </button>
              {showSources && discoveryLinks.length > 0 && (
                <div className="absolute z-10 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
                  {discoveryLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-2 py-1 hover:bg-gray-100 rounded text-xs"
                    >
                      <div className="font-medium text-gray-900 truncate">
                        {link.title}
                      </div>
                      <div className="text-gray-500 truncate">{link.domain}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                onClick={() => {
                  setShowResearch(!showResearch);
                  setShowSources(false);
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Research ({researchLinks.length})
              </button>
              {showResearch && researchLinks.length > 0 && (
                <div className="absolute z-10 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
                  {researchLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block px-2 py-1 hover:bg-gray-100 rounded text-xs"
                    >
                      <div className="font-medium text-gray-900 truncate">
                        {link.title}
                      </div>
                      <div className="text-gray-500 truncate">{link.domain}</div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <button
            onClick={() => setShowEmailEditor(!showEmailEditor)}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {showEmailEditor ? 'Close' : 'Edit Email'}
          </button>
        </td>
      </tr>
      {showEmailEditor && candidate.emailDraft && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-4 py-4">
            <div className="max-w-2xl space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Body
                </label>
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowEmailEditor(false)}
                  className="px-3 py-1.5 text-gray-600 hover:text-gray-800 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={isSaving}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
