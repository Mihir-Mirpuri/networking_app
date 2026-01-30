'use client';

import { useState, useEffect, useRef } from 'react';
import { OutreachTrackerEntry, ThreadMessage, getThreadMessages } from '@/app/actions/outreach';
import { sendFollowUpAction } from '@/app/actions/send';

interface ThreadPanelProps {
  tracker: OutreachTrackerEntry;
  isOpen: boolean;
  onClose: () => void;
}

export function ThreadPanel({ tracker, isOpen, onClose }: ThreadPanelProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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
      // Pre-fill subject from last message
      if (result.messages.length > 0) {
        const lastSubject = result.messages[result.messages.length - 1].subject || '';
        setSubject(lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`);
      }
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  };

  const handleSend = async () => {
    if (!body.trim() || !tracker.gmailThreadId) return;

    setIsSending(true);
    setSendError(null);

    const result = await sendFollowUpAction({
      toEmail: tracker.contactEmail,
      subject,
      body,
      threadId: tracker.gmailThreadId,
      originalMessageId: messages.length > 0 ? messages[messages.length - 1].messageId : undefined,
      userCandidateId: tracker.userCandidateId || '',
    });

    if (result.success) {
      setBody('');
      setShowCompose(false);
      // Refresh messages to show the sent email
      await fetchMessages();
    } else {
      setSendError(result.error || 'Failed to send email');
    }
    setIsSending(false);
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
        className="fixed inset-0 bg-black bg-opacity-30 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {tracker.contactName || tracker.contactEmail}
            </h2>
            <p className="text-sm text-gray-500">{tracker.contactEmail}</p>
            {tracker.company && (
              <p className="text-sm text-gray-500">{tracker.company}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500">Loading messages...</p>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-red-500">{error}</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <p>No messages in this thread yet.</p>
              <p className="text-sm mt-1">Send an email to start the conversation.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.messageId}
                  className={`rounded-lg border ${
                    message.direction === 'SENT'
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${
                          message.direction === 'SENT' ? 'text-blue-700' : 'text-gray-700'
                        }`}>
                          {message.direction === 'SENT' ? 'You' : formatSender(message.sender)}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          message.direction === 'SENT'
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-green-100 text-green-600'
                        }`}>
                          {message.direction === 'SENT' ? 'Sent' : 'Received'}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {formatDate(message.receivedAt)}
                      </span>
                    </div>
                    {message.subject && (
                      <p className="text-sm text-gray-600 mt-1">{message.subject}</p>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    {message.bodyHtml ? (
                      <div
                        className="text-sm text-gray-700 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
                      />
                    ) : (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">
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

        {/* Compose Area */}
        <div className="border-t border-gray-200 px-6 py-4">
          {showCompose ? (
            <div className="space-y-3">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {sendError && (
                <p className="text-sm text-red-600">{sendError}</p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowCompose(false);
                    setBody('');
                    setSendError(null);
                  }}
                  disabled={isSending}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={isSending || !body.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowCompose(true)}
              disabled={!tracker.gmailThreadId}
              className="w-full px-4 py-3 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tracker.gmailThreadId ? 'Reply to this thread' : 'No thread available'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
