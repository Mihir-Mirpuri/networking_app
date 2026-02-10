'use client';

import { useState, useEffect, useRef } from 'react';
import { OutreachTrackerEntry, ThreadMessage, getThreadMessages } from '@/app/actions/outreach';
interface ThreadPanelProps {
  tracker: OutreachTrackerEntry;
  isOpen: boolean;
  onClose: () => void;
}

export function ThreadPanel({ tracker, isOpen, onClose }: ThreadPanelProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && tracker.gmailThreadId) {
      fetchMessages();
    }
  }, [isOpen, tracker.gmailThreadId]);

  useEffect(() => {
    // Scroll to bottom when messages load or new message is sent
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
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatSender = (sender: string) => {
    // Extract name from "Name <email>" format
    const match = sender.match(/^(.+?)\s*<(.+)>$/);
    if (match) {
      return match[1].trim();
    }
    return sender;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-surface-900/40 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-soft-xl z-50 flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200">
          <div>
            <h2 className="text-lg font-semibold text-surface-900">
              {tracker.contactName || tracker.contactEmail}
            </h2>
            <p className="text-sm text-surface-500">{tracker.contactEmail}</p>
            {tracker.company && (
              <p className="text-sm text-surface-500">{tracker.company}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-surface-400 hover:text-surface-600 rounded-lg hover:bg-surface-100 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full gap-2 text-surface-500">
              <svg className="animate-spin h-5 w-5 text-primary-600" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading messages...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-red-500">{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-surface-500">
              <p>No messages in this thread yet.</p>
              <p className="text-sm mt-1">Send an email to start the conversation.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.messageId}
                  className={`rounded-xl border ${
                    message.direction === 'SENT'
                      ? 'bg-primary-50 border-primary-200'
                      : 'bg-surface-50 border-surface-200'
                  }`}
                >
                  <div className="px-4 py-3 border-b border-surface-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${
                          message.direction === 'SENT' ? 'text-primary-700' : 'text-surface-700'
                        }`}>
                          {message.direction === 'SENT' ? 'You' : formatSender(message.sender)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          message.direction === 'SENT'
                            ? 'bg-primary-100 text-primary-600'
                            : 'bg-emerald-100 text-emerald-600'
                        }`}>
                          {message.direction === 'SENT' ? 'Sent' : 'Received'}
                        </span>
                      </div>
                      <span className="text-xs text-surface-500">
                        {formatDate(message.receivedAt)}
                      </span>
                    </div>
                    {message.subject && (
                      <p className="text-sm text-surface-600 mt-1">{message.subject}</p>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    {message.bodyHtml ? (
                      <div
                        className="text-sm text-surface-700 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                      />
                    ) : (
                      <p className="text-sm text-surface-700 whitespace-pre-wrap">
                        {message.bodyText || '(No content)'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

      </div>
    </>
  );
}
