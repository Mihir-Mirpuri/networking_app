'use client';

import { useState, useEffect } from 'react';
import { getSendLogs, SendLogEntry } from '@/app/actions/sendlog';

interface PastEmailsSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function PastEmailsSidebar({ isOpen, onToggle }: PastEmailsSidebarProps) {
  const [logs, setLogs] = useState<SendLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen]);

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
        className="fixed right-0 top-1/2 -translate-y-1/2 bg-blue-600 text-white px-2 py-4 rounded-l-md shadow-lg hover:bg-blue-700 z-40"
        style={{ writingMode: 'vertical-rl' }}
      >
        {isOpen ? 'Close' : 'Past Emails'}
      </button>

      {/* Sidebar */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-white shadow-xl transform transition-transform duration-300 z-50 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Past Emails</h2>
              <button
                onClick={onToggle}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
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
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Search
              </button>
            </div>
          </div>

          {/* Email List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-gray-500">Loading...</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-gray-500">No emails sent yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {logs.map((log) => (
                  <div key={log.id} className="p-3">
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm truncate">
                          {log.toName || log.toEmail}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            log.status === 'SUCCESS'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {log.status === 'SUCCESS' ? 'Sent' : 'Failed'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {log.company}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(log.sentAt)}
                      </p>
                    </button>

                    {/* Expanded View */}
                    {expandedId === log.id && (
                      <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                        <p className="text-xs text-gray-500 mb-1">To:</p>
                        <p className="mb-2">{log.toEmail}</p>
                        <p className="text-xs text-gray-500 mb-1">Subject:</p>
                        <p className="mb-2 font-medium">{log.subject}</p>
                        <p className="text-xs text-gray-500 mb-1">Body:</p>
                        <p className="whitespace-pre-wrap text-xs">
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
          className="fixed inset-0 bg-black bg-opacity-25 z-40"
          onClick={onToggle}
        />
      )}
    </>
  );
}
