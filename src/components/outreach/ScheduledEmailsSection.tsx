'use client';

import { useState, useMemo } from 'react';
import { ScheduledEmailEntry } from '@/app/actions/outreach';
import { cancelScheduledEmailAction, updateScheduledEmailAction } from '@/app/actions/send';

interface ScheduledEmailsSectionProps {
  scheduledEmails: ScheduledEmailEntry[];
  onEmailCancelled: (id: string) => void;
  onEmailUpdated: (id: string, newScheduledFor: Date) => void;
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search scheduled emails..."
        className="w-full pl-10 pr-4 py-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-sm text-white placeholder-[#555] focus:outline-none focus:border-[var(--accent)] transition-colors"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

const AVATAR_COLORS = ['#6364FF', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#f97316'];

function getAvatarColor(name: string | null, email: string): string {
  const str = name || email;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatCountdown(scheduledFor: Date): string {
  const now = new Date();
  const diff = new Date(scheduledFor).getTime() - now.getTime();
  if (diff <= 0) return 'Sending soon';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatScheduledDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduledEmailsSection({
  scheduledEmails,
  onEmailCancelled,
  onEmailUpdated,
}: ScheduledEmailsSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDateTime, setEditDateTime] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEmails = useMemo(() => {
    if (!searchQuery.trim()) return scheduledEmails;
    const q = searchQuery.toLowerCase();
    return scheduledEmails.filter((e) =>
      (e.contactName?.toLowerCase().includes(q)) ||
      e.toEmail.toLowerCase().includes(q) ||
      (e.company?.toLowerCase().includes(q)) ||
      e.subject.toLowerCase().includes(q)
    );
  }, [scheduledEmails, searchQuery]);

  const handleCancel = async (id: string) => {
    setCancelingId(id);
    try {
      const result = await cancelScheduledEmailAction(id);
      if (result.success) {
        onEmailCancelled(id);
      }
    } catch (error) {
      console.error('Error cancelling scheduled email:', error);
    } finally {
      setCancelingId(null);
    }
  };

  const handleEditOpen = (email: ScheduledEmailEntry) => {
    const d = new Date(email.scheduledFor);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEditingId(email.id);
    setEditDateTime(local);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editingId || !editDateTime) return;

    const selectedDate = new Date(editDateTime);
    const now = new Date();
    const minTime = new Date(now.getTime() + 5 * 60 * 1000);

    if (selectedDate < minTime) {
      setEditError('Must be at least 5 minutes in the future');
      return;
    }

    setIsUpdating(true);
    try {
      const result = await updateScheduledEmailAction(editingId, selectedDate);
      if (result.success) {
        onEmailUpdated(editingId, selectedDate);
        setEditingId(null);
        setEditDateTime('');
        setEditError(null);
      } else {
        setEditError(result.error);
      }
    } catch (error) {
      setEditError('Failed to update');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-3">
      {/* Search bar */}
      <SearchInput value={searchQuery} onChange={setSearchQuery} />

      <div className="flex-1 flex flex-col min-h-0 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg overflow-hidden">
        {/* Header Row */}
        <div className="flex-shrink-0 flex items-center px-4 py-2.5 bg-[#2a2a2a] border-b border-[#3a3a3a]">
          <div className="w-10 min-w-[40px] shrink-0" />
          <div className="w-[200px] px-2 shrink-0">
            <span className="text-[13px] font-semibold text-white font-['Inter']">Name</span>
          </div>
          <div className="w-[140px] px-2 shrink-0">
            <span className="text-[13px] font-semibold text-white font-['Inter']">Company</span>
          </div>
          <div className="flex-1 px-2">
            <span className="text-[13px] font-semibold text-white font-['Inter']">Subject</span>
          </div>
          <div className="w-[180px] px-2 shrink-0">
            <span className="text-[13px] font-semibold text-white font-['Inter']">Scheduled For</span>
          </div>
          <div className="w-10 min-w-[40px] shrink-0" />
        </div>

        {/* Data Rows */}
        <div className="flex-1 overflow-y-auto">
          {filteredEmails.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-[#666] text-sm">
              No results found
            </div>
          ) : (
            filteredEmails.map((email) => {
              const avatarColor = getAvatarColor(email.contactName, email.toEmail);
              const initials = getInitials(email.contactName, email.toEmail);
              const isExpanded = expandedId === email.id;

              return (
                <div key={email.id}>
                  {/* Row */}
                  <div
                    className="flex items-center px-4 py-2.5 bg-[#1a1a1a] border-b border-[#2a2a2a] hover:bg-[#252525] cursor-pointer transition-colors group"
                    onClick={() => setExpandedId(isExpanded ? null : email.id)}
                  >
                    {/* Avatar */}
                    <div className="w-10 min-w-[40px] flex justify-center shrink-0">
                      <div
                        className="w-[30px] h-[30px] rounded-full flex items-center justify-center"
                        style={{ backgroundColor: avatarColor }}
                      >
                        <span className="text-[11px] font-semibold text-white font-['Inter']">{initials}</span>
                      </div>
                    </div>

                    {/* Name */}
                    <div className="w-[200px] px-2 shrink-0">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[13px] font-medium text-white font-['Inter'] truncate">
                          {email.contactName || email.toEmail}
                        </span>
                        <span className="text-[11px] text-[#888] font-['Inter'] truncate">
                          {email.toEmail}
                        </span>
                      </div>
                    </div>

                    {/* Company */}
                    <div className="w-[140px] px-2 shrink-0">
                      <span className="text-[13px] text-white font-['Inter'] truncate block">
                        {email.company || <span className="text-[#555]">--</span>}
                      </span>
                    </div>

                    {/* Subject */}
                    <div className="flex-1 px-2 min-w-0">
                      <span className="text-[13px] text-white font-['Inter'] truncate block">
                        {email.subject}
                      </span>
                    </div>

                    {/* Scheduled For */}
                    <div className="w-[180px] px-2 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--accent)]/15 text-[#8b8cff] font-['Inter']">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatScheduledDate(email.scheduledFor)}
                        </span>
                        <span className="text-[11px] text-[#888] font-['Inter']">
                          {formatCountdown(email.scheduledFor)}
                        </span>
                      </div>
                    </div>

                    {/* Expand chevron */}
                    <div className="w-10 min-w-[40px] flex justify-center shrink-0">
                      <svg
                        className={`w-4 h-4 text-[#555] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 py-4 bg-[#222222] border-b border-[#2a2a2a]">
                      {/* Email preview */}
                      <div className="mb-3">
                        <p className="text-xs text-[#888] font-['Inter'] mb-1">Subject</p>
                        <p className="text-[13px] text-white font-['Inter']">{email.subject}</p>
                      </div>
                      <div className="mb-4">
                        <p className="text-xs text-[#888] font-['Inter'] mb-1">Body</p>
                        <p className="text-[13px] text-white font-['Inter'] whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                          {email.body}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditOpen(email);
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-[#2a2a2a] border border-[#3a3a3a] text-white rounded-lg hover:bg-[#333333] transition-colors font-['Inter'] flex items-center gap-1.5"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Edit Time
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(email.id);
                          }}
                          disabled={cancelingId === email.id}
                          className="px-3 py-1.5 text-xs font-medium bg-red-900/20 border border-red-900/30 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors font-['Inter'] flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {cancelingId === email.id ? 'Cancelling...' : 'Cancel Send'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Edit Schedule Modal */}
      {editingId && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingId(null);
              setEditDateTime('');
              setEditError(null);
            }
          }}
        >
          <div className="bg-[#2a2a2a] rounded-2xl shadow-lg shadow-black/40 max-w-sm w-full p-6 animate-scale-in border border-[#3a3a3a]">
            <h3 className="text-lg font-semibold mb-4 text-white font-['Inter']">Edit Scheduled Time</h3>

            <input
              type="datetime-local"
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-white text-sm font-['Inter'] mb-3 focus:outline-none focus:border-[var(--accent)]"
              value={editDateTime}
              onChange={(e) => {
                setEditDateTime(e.target.value);
                setEditError(null);
              }}
            />

            {editError && (
              <p className="text-xs text-red-400 mb-3 font-['Inter']">{editError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setEditingId(null);
                  setEditDateTime('');
                  setEditError(null);
                }}
                className="px-4 py-2 text-sm font-medium bg-[#333333] text-white rounded-lg hover:bg-[#3a3a3a] transition-all font-['Inter']"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={isUpdating || !editDateTime}
                className="px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-all font-['Inter'] disabled:opacity-50"
              >
                {isUpdating ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
