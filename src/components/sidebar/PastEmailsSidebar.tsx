'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { getSendLogs, SendLogEntry } from '@/app/actions/sendlog';

interface PastEmailsSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function PastEmailsSidebar({ isOpen, onToggle }: PastEmailsSidebarProps) {
  const { status } = useSession();
  const [logs, setLogs] = useState<SendLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && status === 'authenticated') {
      loadLogs();
    }
  }, [isOpen, status]);

  const loadLogs = async (query?: string) => {
    setIsLoading(true);
    const result = await getSendLogs(query);
    if (result.success) {
      setLogs(result.logs);
    }
    setIsLoading(false);
  };

  const handleSearch = () => {
    loadLogs(searchQuery || undefined);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="fixed right-0 top-1/2 -translate-y-1/2 bg-primary-600 text-white px-2 py-4 rounded-l-lg shadow-lg hover:bg-primary-700 transition-colors z-40"
        style={{ writingMode: 'vertical-rl' }}
      >
        {isOpen ? 'Close' : 'Past Emails'}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-white shadow-soft-xl transform transition-transform duration-300 z-50 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-surface-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-surface-900">Past Emails</h2>
              <button
                onClick={onToggle}
                className="p-2 hover:bg-surface-100 rounded-lg transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-surface-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search emails..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="input flex-1 text-sm"
              />
              <button
                onClick={handleSearch}
                className="btn-primary text-sm"
              >
                Search
              </button>
            </div>
          </div>

          {/* Email List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-surface-500">
                <svg className="animate-spin h-5 w-5 text-primary-600" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm">Loading...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-surface-500">No emails sent yet</p>
              </div>
            ) : (
              <div className="divide-y divide-surface-100">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 hover:bg-surface-50 transition-colors">
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm truncate text-surface-900">
                          {log.toName || log.toEmail}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            log.status === 'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {log.status === 'SUCCESS' ? 'Sent' : 'Failed'}
                        </span>
                      </div>
                      <p className="text-xs text-surface-500 truncate">
                        {log.company}
                      </p>
                      <p className="text-xs text-surface-400">
                        {formatDate(log.sentAt)}
                      </p>
                    </button>

                    {/* Expanded View */}
                    {expandedId === log.id && (
                      <div className="mt-2 p-3 bg-surface-50 rounded-lg text-sm">
                        <p className="text-xs text-surface-500 mb-1">To:</p>
                        <p className="mb-2 text-surface-800">{log.toEmail}</p>
                        <p className="text-xs text-surface-500 mb-1">Subject:</p>
                        <p className="mb-2 font-medium text-surface-800">{log.subject}</p>
                        <p className="text-xs text-surface-500 mb-1">Body:</p>
                        <p className="whitespace-pre-wrap text-xs text-surface-700">
                          {log.body}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-surface-900/30 backdrop-blur-sm z-40"
          onClick={onToggle}
        />
      )}
    </>
  );
}
