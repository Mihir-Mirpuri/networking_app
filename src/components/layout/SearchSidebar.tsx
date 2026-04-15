'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { COMPANIES, ROLES, ROLES_BY_COMPANY, LOCATIONS } from '@/lib/constants';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { useEmailChat } from '@/contexts/EmailChatContext';
import { EmailChatPanel } from '@/components/sidebar/EmailChatPanel';
import { DisplayMessage } from './MainSearchView';
import { Selectable, SuggestedAlternative, SuggestedSearch } from '@/app/actions/ai-search';


// Signal logo component
function SignalLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="80" r="12" fill="currentColor" />
      <path d="M78 56 A30 30 0 0 0 78 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M122 56 A30 30 0 0 1 122 104" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M58 38 A55 55 0 0 0 58 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M142 38 A55 55 0 0 1 142 122" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M38 20 A80 80 0 0 0 38 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
      <path d="M162 20 A80 80 0 0 1 162 140" stroke="currentColor" strokeWidth="10" strokeLinecap="round" fill="none" />
    </svg>
  );
}


interface SearchSidebarProps {
  onSearchSubmit: (query: string) => void;
  onFilterSubmit: (filters: { company?: string; role?: string; university?: string; location?: string }) => void;
  isOpen: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
  isSearching?: boolean;
  aiMode: boolean;
  // Chat props
  messages: DisplayMessage[];
  isExtracting: boolean;
  onSelectableClick: (selectable: Selectable) => void;
  onShowMoreSelectables: (messageId: string) => void;
  onSuggestedAlternativeClick: (alt: SuggestedAlternative) => void;
  onSuggestedSearchClick: (search: SuggestedSearch) => void;
  onClearChat: () => void;
}

export function SearchSidebar({
  onSearchSubmit,
  onFilterSubmit,
  isOpen,
  onClose,
  onToggleSidebar,
  isSearching,
  aiMode,
  messages,
  isExtracting,
  onSelectableClick,
  onShowMoreSelectables,
  onSuggestedAlternativeClick,
  onSuggestedSearchClick,
  onClearChat,
}: SearchSidebarProps) {
  const { data: session } = useSession();
  const [inputValue, setInputValue] = useState('');
  const { isEmailReviewOpen } = useEmailChat();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 80) + 'px';
  }, [inputValue]);

  // Filter state
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [university, setUniversity] = useState('');
  const [location, setLocation] = useState('');

  const availableRoles = company
    ? (ROLES_BY_COMPANY[company] || [...ROLES])
    : [...ROLES];

  const hasFilters = company || role || university || location;

  const handleAiSubmit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSearching) return;
    onSearchSubmit(trimmed);
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFilterSearch = () => {
    if (!hasFilters || isSearching) return;
    onFilterSubmit({
      company: company || undefined,
      role: role || undefined,
      university: university || undefined,
      location: location || undefined,
    });
  };

  const handleClearFilters = () => {
    setCompany('');
    setRole('');
    setUniversity('');
    setLocation('');
  };

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static
          fixed top-0 bottom-0 left-0 z-30
          w-80 ${isEmailReviewOpen ? 'bg-[#141414]' : 'bg-[#181818]'}
          flex flex-col
          transition-transform duration-300
        `}
      >
        {/* Top header with logo */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-white hover:text-white transition-colors"
                aria-label="Toggle sidebar"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            )}
            <Link href="/" className="flex items-center gap-2 group">
              <SignalLogo className="w-7 h-7" />
              <span className="text-xl font-bold text-white group-hover:text-white transition-colors">
                Signl
              </span>
            </Link>
          </div>
          <button
            onClick={onClearChat}
            className="text-[#888] hover:text-white transition-colors"
            title="New session"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c0-4.97 4.03-9 9-9h2c4.97 0 9 4.03 9 9 0 4.97-4.03 9-9 9H9l-4.5 3V18.5C2.9 16.8 2 14.5 2 12Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v8M8 12h8" />
            </svg>
          </button>
        </div>

        {/* Main content area - Email Chat Panel or Search Filters */}
        {isEmailReviewOpen ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <EmailChatPanel />
          </div>
        ) : (
          <>
            <div className={`flex-1 overflow-y-auto flex flex-col ${aiMode ? '' : 'justify-center'}`}>
              {aiMode ? (
                /* AI mode: chat messages */
                <div className="flex-1 flex flex-col p-3 overflow-y-auto">
                  <div className="space-y-3">
                    {/* Initial greeting - always shown */}
                    <div className="flex gap-2 w-[85%]">
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
                        <SignalLogo className="w-3 h-3 text-white" />
                      </div>
                      <div className={`rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md flex-1 min-w-0 bg-[var(--accent)]`}>
                        <p>Hi{session?.user?.name ? ` ${session.user.name.split(' ')[0]}` : ''}! I&apos;m Signl. Who would you like to find today? Try:</p>
                        <div className="mt-2 space-y-1">
                          <button
                            onClick={() => onSearchSubmit('Harvard alumni who work at Google')}
                            className="block w-full text-left text-white/90 hover:text-white hover:underline transition-colors"
                          >
                            → Harvard alumni who work at Google
                          </button>
                          <button
                            onClick={() => onSearchSubmit('People who work at Goldman Sachs in the New York office who went to UT Austin')}
                            className="block w-full text-left text-white/90 hover:text-white hover:underline transition-colors"
                          >
                            → People who work at Goldman Sachs in the New York office who went to UT Austin
                          </button>
                          <button
                            onClick={() => onSearchSubmit('Product managers at Stripe')}
                            className="block w-full text-left text-white/90 hover:text-white hover:underline transition-colors"
                          >
                            → Product managers at Stripe
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* User messages */}
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        {msg.role === 'user' ? (
                          // User message - right-aligned with bubble and profile image
                          <div className="flex gap-2 max-w-[85%]">
                            <div className="rounded-2xl px-3 py-2 text-sm bg-[#2a2a2a] text-white rounded-br-md">
                              {msg.content}
                            </div>
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1 overflow-hidden">
                              {session?.user?.image ? (
                                <img src={session.user.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                </svg>
                              )}
                            </div>
                          </div>
                        ) : (
                          // AI message - left-aligned with bubble and Signal logo
                          // Blue for premium (like iMessage), green for free (like SMS), neutral while loading
                          <div className={`flex gap-2 ${msg.isLoading ? 'w-fit' : 'w-[85%]'}`}>
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252525] flex items-center justify-center mt-1">
                              <SignalLogo className="w-3 h-3 text-white" />
                            </div>
                            <div className={`rounded-2xl px-3 py-2 text-sm text-white rounded-bl-md ${msg.isLoading ? 'w-fit' : 'flex-1 min-w-0'} bg-[var(--accent)]`}>
                              {msg.isLoading ? (
                                <div className="flex items-center gap-1.5 py-1">
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '0ms' }} />
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '150ms' }} />
                                  <div className="w-1.5 h-1.5 rounded-full bg-[#505050] animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                              ) : (
                                <>
                                  {msg.content}
                                  {msg.selectables && msg.selectables.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                      {msg.selectables.map((s) => (
                                        <button
                                          key={s.filterValue}
                                          onClick={() => onSelectableClick(s)}
                                          disabled={isExtracting || isSearching}
                                          className="px-2.5 py-1 text-xs font-medium text-white bg-[#252525] border border-[#383838] rounded-full hover:bg-[#333333] hover:border-[#484848] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {s.label}
                                        </button>
                                      ))}
                                      {msg.allSelectables && msg.allSelectables.length > ((msg.selectablesPage || 0) + 1) * 5 && (
                                        <button
                                          onClick={() => onShowMoreSelectables(msg.id)}
                                          disabled={isExtracting || isSearching}
                                          className="px-2.5 py-1 text-xs font-medium text-white bg-[#1a1a1a] border border-[#333333] rounded-full hover:bg-[#252525] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          Show more...
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {msg.suggestedAlternative && (
                                    <div className="mt-3">
                                      <p className="text-xs text-white/60 mb-1.5">Try instead:</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        <button
                                          onClick={() => onSuggestedAlternativeClick(msg.suggestedAlternative!)}
                                          disabled={isExtracting || isSearching}
                                          className="flex items-center gap-1.5 px-2.5 py-1.5 max-w-[200px] text-xs font-medium text-white bg-[var(--accent-badge-bg)] border border-[var(--accent-border)] rounded-full opacity-60 hover:opacity-100 hover:border-[var(--accent)] transition-all duration-200 disabled:cursor-not-allowed"
                                        >
                                          <svg className="w-3 h-3 flex-shrink-0 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                          </svg>
                                          <span className="truncate">{msg.suggestedAlternative.label}</span>
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  {msg.suggestedSearches && msg.suggestedSearches.length > 0 && (
                                    <div className="mt-3">
                                      <p className="text-xs text-white/60 mb-1.5">Related searches:</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {msg.suggestedSearches.map((s, i) => (
                                          <button
                                            key={i}
                                            onClick={() => onSuggestedSearchClick(s)}
                                            disabled={isExtracting || isSearching}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 max-w-full text-xs font-medium text-white bg-[var(--accent-badge-bg)] border border-[var(--accent-border)] rounded-full opacity-60 hover:opacity-100 hover:border-[var(--accent)] transition-all duration-200 disabled:cursor-not-allowed"
                                          >
                                            <svg className="w-3 h-3 flex-shrink-0 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                            </svg>
                                            <span className="truncate">{s.label}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </div>
              ) : (
                /* Filter mode: dropdowns with sentence context */
                <div className="px-4 py-6 space-y-3">
                  <p className="text-sm text-white text-center">I&apos;m looking for a</p>
                  <SearchableCombobox
                    options={[
                      { label: 'Any Role', value: '' },
                      ...availableRoles.map((r) => ({ label: r, value: r })),
                    ]}
                    value={role}
                    onChange={setRole}
                    label=""
                    placeholder="Type or select a role..."
                    id="sidebar-role"
                    allowFreeText
                  />
                  <p className="text-sm text-white text-center">at</p>
                  <SearchableCombobox
                    options={[
                      { label: 'Any Company', value: '' },
                      ...COMPANIES.map((c) => ({ label: c, value: c })),
                    ]}
                    value={company}
                    onChange={setCompany}
                    label=""
                    placeholder="Type or select a company..."
                    id="sidebar-company"
                    allowFreeText
                  />
                  <p className="text-sm text-white text-center">in the</p>
                  <SearchableCombobox
                    options={[
                      { label: 'Any Location', value: '' },
                      ...LOCATIONS.filter((loc) => loc !== '').map((loc) => ({
                        label: loc,
                        value: loc,
                      })),
                    ]}
                    value={location}
                    onChange={setLocation}
                    label=""
                    placeholder="Type or select a location..."
                    id="sidebar-location"
                    allowFreeText
                  />
                  <p className="text-sm text-white text-center">office who went to</p>
                  <SearchableCombobox
                    options={[
                      { label: 'Any University', value: '' },
                      { label: 'University of Texas at Austin', value: 'University of Texas at Austin' },
                      { label: 'Texas A&M University', value: 'Texas A&M University' },
                    ]}
                    value={university}
                    onChange={setUniversity}
                    label=""
                    placeholder="Type or select a university..."
                    id="sidebar-university"
                    allowFreeText
                  />

                  <div className="flex gap-2 pt-4">
                    {hasFilters && (
                      <button
                        onClick={handleClearFilters}
                        className="px-3 py-2 text-sm text-white hover:text-white transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={handleFilterSearch}
                      disabled={!hasFilters || isSearching}
                      className="flex-1 py-2 text-sm font-medium rounded-lg bg-[#2a2a2a] text-white hover:bg-[#333333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSearching ? 'Searching...' : 'Search'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom input — AI mode only */}
            {aiMode && (
              <div className="p-3 border-t border-[#1a1a1a]">
                <div
                  className="relative bg-[#111111] rounded-lg cursor-text"
                  onClick={() => textareaRef.current?.focus()}
                >
                  <textarea
                    ref={textareaRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAiSubmit();
                      }
                    }}
                    placeholder="Describe who you're looking for..."
                    disabled={isSearching}
                    maxLength={500}
                    rows={1}
                    className="w-full px-3 pr-10 py-2.5 text-sm bg-transparent border-none text-white placeholder-[#505050] focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
                    style={{ maxHeight: '80px' }}
                  />
                  <button
                    onClick={handleAiSubmit}
                    disabled={!inputValue.trim() || isSearching}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-white disabled:text-[#404040] disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
