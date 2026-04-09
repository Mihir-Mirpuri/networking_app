'use client';

import { useState, useRef, useEffect } from 'react';
import { useDrafter } from '@/contexts/DrafterContext';
import { TemplateSelector } from './TemplateSelector';
import { ChatMessages } from './ChatMessages';

export function DrafterPanel() {
  const {
    isOpen,
    phase,
    messages,
    isProcessing,
    currentDraft,
    sendMessage,
    copyDraft,
    closeDrafter,
    resetSession,
  } = useDrafter();

  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Focus input when entering gap_filling or refinement phase
  useEffect(() => {
    if ((phase === 'gap_filling' || phase === 'refinement') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase]);

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

  if (!isOpen) return null;

  const showChatInterface = phase === 'gap_filling' || phase === 'drafting' || phase === 'refinement';
  const showDraft = phase === 'refinement' && currentDraft !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg h-[600px] bg-[#141414] rounded-xl shadow-2xl border border-[#252525] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#252525]">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-white">AI Drafter</h2>
            {phase !== 'template_selection' && (
              <button
                onClick={resetSession}
                className="text-xs text-white hover:text-white transition-colors"
              >
                Start over
              </button>
            )}
          </div>
          <button
            onClick={closeDrafter}
            className="p-1.5 text-white hover:text-white hover:bg-[#252525] rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {phase === 'template_selection' ? (
            <TemplateSelector />
          ) : showChatInterface ? (
            <>
              {/* Chat messages area */}
              <ChatMessages
                messages={messages}
                isProcessing={isProcessing}
                currentDraft={currentDraft}
                showDraft={showDraft}
                onCopyDraft={copyDraft}
              />

              {/* Input area */}
              <div className="p-3 border-t border-[#252525]">
                <form onSubmit={handleSubmit}>
                  <div className="relative">
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        phase === 'refinement'
                          ? 'Request changes...'
                          : 'Type your answer...'
                      }
                      disabled={isProcessing || phase === 'drafting'}
                      rows={1}
                      className="w-full px-3 py-2.5 pr-10 text-sm bg-[#1a1a1a] border border-[#303030] rounded-lg text-white placeholder:text-[#404040] focus:outline-none focus:ring-0 focus:border-[#303030] disabled:opacity-50 disabled:cursor-not-allowed resize-none transition-colors"
                      style={{ minHeight: '42px', maxHeight: '120px' }}
                    />
                    <button
                      type="submit"
                      disabled={!inputValue.trim() || isProcessing || phase === 'drafting'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[#404040] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                      </svg>
                    </button>
                  </div>
                </form>

              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
