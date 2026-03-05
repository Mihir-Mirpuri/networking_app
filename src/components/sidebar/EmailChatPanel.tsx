'use client';

import { useState, useRef, useEffect } from 'react';
import { useEmailChat } from '@/contexts/EmailChatContext';

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-[#505050] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

export function EmailChatPanel() {
  const {
    messages,
    isProcessing,
    sendMessage,
  } = useEmailChat();

  const [inputValue, setInputValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const message = inputValue.trim();
    if (!message || isProcessing) return;

    setInputValue('');
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#141414]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {messages.length === 0 && !isProcessing && (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <p className="text-sm text-[#606060] mb-2">How can I help with this email?</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {['Make it shorter', 'More professional', 'Add a hook'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInputValue(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1.5 text-xs text-[#606060] border border-[#303030] rounded-full hover:border-[#404040] hover:text-[#808080] transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.length > 0 && (
          <div className="px-4 py-4 space-y-4">
            {messages.map((message) => (
              <div key={message.id}>
                {message.role === 'user' ? (
                  // User message - minimal, right-aligned text
                  <div className="flex justify-end">
                    <div className="max-w-[90%] text-right">
                      <p className="text-sm text-[#c0c0c0] whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ) : (
                  // AI message - left-aligned with subtle styling
                  <div className="flex gap-2">
                    <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                      <svg className="w-3 h-3 text-[#606060]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#909090] whitespace-pre-wrap leading-relaxed">{message.content}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Processing indicator */}
            {isProcessing && (
              <div className="flex gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded bg-[#252525] flex items-center justify-center mt-0.5">
                  <svg className="w-3 h-3 text-[#606060]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                </div>
                <TypingIndicator />
              </div>
            )}

            {/* Auto-scroll anchor */}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Input area - Cursor style */}
      <div className="p-3 border-t border-[#252525]">
        <form onSubmit={handleSubmit}>
          <div className="relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything..."
              disabled={isProcessing}
              rows={1}
              className="w-full px-3 py-2.5 pr-10 text-sm bg-[#1a1a1a] border border-[#303030] rounded-lg text-[#c0c0c0] placeholder:text-[#404040] focus:outline-none focus:ring-0 focus:border-[#303030] disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isProcessing}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[#404040] hover:text-[#808080] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
