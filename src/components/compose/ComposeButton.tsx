'use client';

import { useState } from 'react';
import { ComposeEmailModal } from './ComposeEmailModal';

interface ComposeButtonProps {
  className?: string;
}

export function ComposeButton({ className }: ComposeButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const handleSuccess = (messageId: string, threadId: string) => {
    console.log('[Compose] Email sent successfully:', { messageId, threadId });
    setShowSuccessToast(true);
    setTimeout(() => setShowSuccessToast(false), 3000);
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsModalOpen(true)}
        className={`fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 z-40 flex items-center justify-center ${className || ''}`}
        aria-label="Compose new email"
      >
        {/* Pencil/Compose Icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          />
        </svg>
      </button>

      {/* Compose Modal */}
      <ComposeEmailModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleSuccess}
      />

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed bottom-24 right-6 bg-green-600 text-white px-4 py-2 rounded-md shadow-lg z-50 animate-fade-in">
          Email sent successfully!
        </div>
      )}
    </>
  );
}
