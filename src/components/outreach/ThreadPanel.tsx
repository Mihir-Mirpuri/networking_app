'use client';

import { useState, useEffect, useRef } from 'react';
import { OutreachTrackerEntry, ThreadMessage, getThreadMessages } from '@/app/actions/outreach';
import { generateFollowUpFromThreadAction } from '@/app/actions/personalize';
import { sendFollowUpAction } from '@/app/actions/send';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';

interface ThreadPanelProps {
  tracker: OutreachTrackerEntry;
  isOpen: boolean;
  onClose: () => void;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  }
  return email[0].toUpperCase();
}

export function ThreadPanel({ tracker, isOpen, onClose }: ThreadPanelProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  // Follow-up state
  const [showCompose, setShowCompose] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [followUpSubject, setFollowUpSubject] = useState('');
  const [followUpBody, setFollowUpBody] = useState('');
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [userCandidateId, setUserCandidateId] = useState<string | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && tracker.gmailThreadId) {
      fetchMessages();
    }
  }, [isOpen, tracker.gmailThreadId]);

  useEffect(() => {
    // Expand all messages by default, or just the last one for long threads
    if (messages.length > 0) {
      if (messages.length <= 3) {
        setExpandedMessages(new Set(messages.map(m => m.messageId)));
      } else {
        // Expand only the last message
        setExpandedMessages(new Set([messages[messages.length - 1].messageId]));
      }
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMessages = async () => {
    if (!tracker.gmailThreadId) return;

    setIsLoading(true);
    setError(null);

    const result = await getThreadMessages(tracker.gmailThreadId);
    if (result.success) {
      setMessages(result.messages);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    } else {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    }
  };

  const formatFullDate = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatSender = (sender: string) => {
    const match = sender.match(/^(.+?)\s*<(.+)>$/);
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    return { name: sender, email: sender };
  };

  const toggleMessage = (messageId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const handleGenerateFollowUp = async () => {
    if (!tracker.gmailThreadId) {
      setFollowUpError('No email thread found');
      return;
    }

    setIsGenerating(true);
    setFollowUpError(null);

    try {
      const result = await generateFollowUpFromThreadAction(tracker.gmailThreadId);
      if (result.success && result.subject && result.body) {
        setFollowUpSubject(result.subject);
        setFollowUpBody(result.body);
        setUserCandidateId(result.userCandidateId || null);
        setShowCompose(true);
      } else {
        setFollowUpError(result.error || 'Failed to generate follow-up');
      }
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : 'Failed to generate follow-up');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendFollowUp = async () => {
    if (!tracker.gmailThreadId || !followUpBody.trim()) return;

    setIsSending(true);
    setFollowUpError(null);

    try {
      const result = await sendFollowUpAction({
        toEmail: tracker.contactEmail,
        subject: followUpSubject,
        body: followUpBody,
        threadId: tracker.gmailThreadId,
        userCandidateId: userCandidateId || tracker.userCandidateId || '',
      });

      if (result.success) {
        dispatchCreditsChanged();
        setShowCompose(false);
        setFollowUpSubject('');
        setFollowUpBody('');
        fetchMessages();
      } else if (result.error === 'LIMIT_REACHED') {
        setShowLimitModal(true);
      } else {
        setFollowUpError(result.error || 'Failed to send follow-up');
      }
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : 'Failed to send follow-up');
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  const subject = messages[0]?.subject || 'Conversation';

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      {/* Modal */}
      <div
        className="w-full max-w-3xl max-h-[90vh] bg-[#1a1a1a] rounded-xl shadow-2xl flex flex-col animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Gmail style */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#303030]">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-lg font-normal text-white truncate">
              {subject}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-[#9aa0a6]">
                {tracker.contactName || tracker.contactEmail}
              </span>
              {tracker.company && (
                <>
                  <span className="text-[#5f6368]">·</span>
                  <span className="text-sm text-[#9aa0a6]">{tracker.company}</span>
                </>
              )}
              <span className="text-xs text-[#5f6368] bg-[#303030] px-2 py-0.5 rounded">
                {messages.length} {messages.length === 1 ? 'message' : 'messages'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#9aa0a6] hover:text-white hover:bg-[#303030] rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages - Gmail style */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-64 gap-2 text-[#9aa0a6]">
              <LoadingSpinner size="md" />
              <span>Loading...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-red-400">{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-[#9aa0a6]">
              <svg className="w-12 h-12 mb-3 text-[#5f6368]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <p>No messages yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[#303030]">
              {messages.map((message, index) => {
                const isExpanded = expandedMessages.has(message.messageId);
                const sender = formatSender(message.sender);
                const isYou = message.direction === 'SENT';
                const initials = isYou ? 'Y' : getInitials(sender.name, sender.email);

                return (
                  <div key={message.messageId} className="hover:bg-[#202020] transition-colors">
                    {/* Message header - always visible */}
                    <div
                      className="flex items-start gap-3 px-6 py-3 cursor-pointer"
                      onClick={() => toggleMessage(message.messageId)}
                    >
                      {/* Avatar */}
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium ${
                        isYou
                          ? 'bg-[#1a73e8] text-white'
                          : 'bg-[#5f6368] text-white'
                      }`}>
                        {initials}
                      </div>

                      {/* Sender info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium text-white truncate">
                              {isYou ? 'me' : sender.name}
                            </span>
                            {!isExpanded && (
                              <span className="text-sm text-[#9aa0a6] truncate hidden sm:inline">
                                — {(message.bodyText || '').slice(0, 80)}...
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[#9aa0a6] flex-shrink-0" title={formatFullDate(message.receivedAt)}>
                            {formatDate(message.receivedAt)}
                          </span>
                        </div>
                        {isExpanded && (
                          <p className="text-sm text-[#9aa0a6] mt-0.5">
                            to {isYou ? tracker.contactName || tracker.contactEmail : 'me'}
                          </p>
                        )}
                      </div>

                      {/* Expand/collapse indicator */}
                      <svg
                        className={`w-4 h-4 text-[#5f6368] flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Message body - collapsible */}
                    {isExpanded && (
                      <div className="px-6 pb-4 pl-[76px]">
                        {message.bodyHtml ? (
                          <div
                            className="text-sm text-[#e8eaed] prose prose-sm prose-invert max-w-none leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                          />
                        ) : (
                          <p className="text-sm text-[#e8eaed] whitespace-pre-wrap leading-relaxed">
                            {message.bodyText || '(No content)'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Reply section - Gmail style */}
        {tracker.gmailThreadId && messages.length > 0 && (
          <div className="border-t border-[#303030] p-4 bg-[#1a1a1a]">
            {showCompose ? (
              <div className="bg-[#202020] rounded-lg border border-[#303030]">
                <div className="px-4 py-3 border-b border-[#303030]">
                  <input
                    type="text"
                    value={followUpSubject}
                    onChange={(e) => setFollowUpSubject(e.target.value)}
                    className="w-full bg-transparent text-white text-sm outline-none placeholder-[#5f6368]"
                    placeholder="Subject"
                  />
                </div>
                <textarea
                  value={followUpBody}
                  onChange={(e) => setFollowUpBody(e.target.value)}
                  placeholder="Write your reply..."
                  rows={6}
                  className="w-full px-4 py-3 bg-transparent text-white text-sm placeholder-[#5f6368] outline-none resize-none"
                  autoFocus
                />
                {followUpError && (
                  <p className="px-4 pb-2 text-sm text-red-400">{followUpError}</p>
                )}
                <div className="flex items-center justify-between px-4 py-3 border-t border-[#303030]">
                  <button
                    onClick={handleSendFollowUp}
                    disabled={isSending || !followUpBody.trim()}
                    className="px-6 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white text-sm font-medium rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isSending ? (
                      <>
                        <LoadingSpinner size="sm" />
                        Sending...
                      </>
                    ) : (
                      'Send'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setShowCompose(false);
                      setFollowUpSubject('');
                      setFollowUpBody('');
                      setFollowUpError(null);
                    }}
                    className="p-2 text-[#9aa0a6] hover:text-white hover:bg-[#303030] rounded-full transition-colors"
                    title="Discard"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleGenerateFollowUp}
                disabled={isGenerating}
                className="w-full flex items-center gap-3 px-4 py-3 bg-[#202020] hover:bg-[#252525] border border-[#303030] rounded-full text-[#9aa0a6] hover:text-white transition-colors text-left"
              >
                {isGenerating ? (
                  <>
                    <LoadingSpinner size="sm" />
                    <span className="text-sm">Generating reply...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-[#5f6368]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    <span className="text-sm">Click here to write a follow-up...</span>
                  </>
                )}
              </button>
            )}
            {followUpError && !showCompose && (
              <p className="text-sm text-red-400 mt-2 text-center">{followUpError}</p>
            )}
          </div>
        )}
      </div>

      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          setShowLimitModal(false);
          dispatchCreditsChanged();
        }}
      />
    </div>
  );
}
