'use client';

import { useRef, useEffect } from 'react';
import { ChatMessage } from '@/contexts/DrafterContext';
import { EmailDraft } from '@/lib/services/drafter';
import { DraftBubble } from './DraftBubble';

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function AIIcon() {
  return (
    <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
      </svg>
    </div>
  );
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  currentDraft: EmailDraft | null;
  showDraft: boolean;
  onCopyDraft: () => void;
}

export function ChatMessages({
  messages,
  isProcessing,
  currentDraft,
  showDraft,
  onCopyDraft,
}: ChatMessagesProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing, currentDraft]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((message) => (
        <div key={message.id}>
          {message.role === 'user' ? (
            // User message - minimal, right-aligned text
            <div className="flex justify-end">
              <div className="max-w-[90%] text-right">
                <p className="text-sm text-white whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ) : (
            // AI message - left-aligned with subtle styling
            <div className="flex gap-2">
              <AIIcon />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{message.content}</p>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Draft bubble - shown in refinement phase */}
      {showDraft && currentDraft && (
        <div className="mt-4">
          <DraftBubble draft={currentDraft} onCopy={onCopyDraft} />
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="flex gap-2 items-start w-fit">
          <AIIcon />
          <div className="bg-[#252525] rounded-lg px-3 py-2">
            <TypingIndicator />
          </div>
        </div>
      )}

      {/* Auto-scroll anchor */}
      <div ref={chatEndRef} />
    </div>
  );
}
