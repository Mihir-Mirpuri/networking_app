'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { COMPANIES, ROLES, ROLES_BY_COMPANY, LOCATIONS } from '@/lib/constants';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { useEmailChat } from '@/contexts/EmailChatContext';
import { EmailChatPanel } from '@/components/sidebar/EmailChatPanel';
import { DisplayMessage } from './MainSearchView';
import { Selectable } from '@/app/actions/ai-search';

// Mascot SVG component
function MascotSVG({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="54" fill="url(#mascotBgSidebar)"/>
      <path
        d="M18 60 Q25 42 32 60 Q39 78 46 60 Q53 42 60 60 Q67 78 74 60 Q81 42 88 60 Q95 78 102 60"
        stroke="url(#waveGradSidebar)"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="52" cy="52" r="5" fill="#e0e0e0"/>
      <circle cx="68" cy="52" r="5" fill="#e0e0e0"/>
      <circle cx="53.5" cy="53.5" r="2.5" fill="#1a1a1a"/>
      <circle cx="69.5" cy="53.5" r="2.5" fill="#1a1a1a"/>
      <circle cx="54.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
      <circle cx="70.5" cy="52.5" r="1" fill="white" opacity="0.8"/>
      <path d="M52 70 Q60 77 68 70" stroke="#e0e0e0" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
      <line x1="60" y1="6" x2="60" y2="22" stroke="#808080" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="60" cy="5" r="3.5" fill="#a0a0a0"/>
      <circle cx="60" cy="5" r="6" fill="rgba(160,160,160,0.3)"/>
      <defs>
        <linearGradient id="waveGradSidebar" x1="18" y1="60" x2="102" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#505050"/>
          <stop offset="50%" stopColor="#808080"/>
          <stop offset="100%" stopColor="#505050"/>
        </linearGradient>
        <radialGradient id="mascotBgSidebar" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3a3a3a"/>
          <stop offset="100%" stopColor="#252525"/>
        </radialGradient>
      </defs>
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
  onAiModeChange: (aiMode: boolean) => void;
  // Chat props
  messages: DisplayMessage[];
  isExtracting: boolean;
  onSelectableClick: (selectable: Selectable) => void;
  onShowMoreSelectables: (messageId: string) => void;
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
  onAiModeChange,
  messages,
  isExtracting,
  onSelectableClick,
  onShowMoreSelectables,
  onClearChat,
}: SearchSidebarProps) {
  const [inputValue, setInputValue] = useState('');
  const { isEmailReviewOpen } = useEmailChat();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
                className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-[#808080] hover:text-white transition-colors"
                aria-label="Toggle sidebar"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>
            )}
            <Link href="/" className="flex items-center gap-2 group">
              <MascotSVG className="w-7 h-7" />
              <span className="text-xl font-bold text-white group-hover:text-[#a0a0a0] transition-colors">
                Signl
              </span>
            </Link>
          </div>
          {!isEmailReviewOpen && (
            <button
              onClick={() => onAiModeChange(!aiMode)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                aiMode
                  ? 'bg-[#2a2a2a] text-[#c0c0c0] border border-[#404040]'
                  : 'bg-[#1a1a1a] text-[#606060] border border-[#2a2a2a] hover:text-[#808080] hover:border-[#333333]'
              }`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
              </svg>
              AI
              <span className={`text-[10px] px-1 py-px rounded ${
                aiMode ? 'bg-[#383838] text-[#a0a0a0]' : 'bg-[#2a2a2a] text-[#505050]'
              }`}>
                Beta
              </span>
            </button>
          )}
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
                <div className="flex-1 flex flex-col p-3">
                  {messages.length > 0 ? (
                    <div className="flex-1 overflow-y-auto">
                      <div className="space-y-3">
                        {messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                                msg.role === 'user'
                                  ? 'bg-[#2a2a2a] text-[#c0c0c0] rounded-br-md'
                                  : 'bg-[#1a1a1a] text-[#909090] rounded-bl-md'
                              }`}
                            >
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
                                          className="px-2.5 py-1 text-xs font-medium text-[#a0a0a0] bg-[#252525] border border-[#383838] rounded-full hover:bg-[#333333] hover:border-[#484848] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          {s.label}
                                        </button>
                                      ))}
                                      {msg.allSelectables && msg.allSelectables.length > ((msg.selectablesPage || 0) + 1) * 5 && (
                                        <button
                                          onClick={() => onShowMoreSelectables(msg.id)}
                                          disabled={isExtracting || isSearching}
                                          className="px-2.5 py-1 text-xs font-medium text-[#707070] bg-[#1a1a1a] border border-[#333333] rounded-full hover:bg-[#252525] hover:text-[#909090] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          Show more...
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        <div ref={chatEndRef} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-[#505050] text-center px-4">
                        Ask me who you want to find...
                      </p>
                    </div>
                  )}
                  {messages.length > 0 && (
                    <button
                      onClick={onClearChat}
                      className="mt-2 self-center px-3 py-1 text-xs text-[#606060] hover:text-[#909090] transition-colors"
                    >
                      Clear chat
                    </button>
                  )}
                </div>
              ) : (
                /* Filter mode: dropdowns with sentence context */
                <div className="px-4 py-6 space-y-3">
                  <p className="text-sm text-[#606060] text-center">I&apos;m looking for a</p>
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
                  <p className="text-sm text-[#606060] text-center">at</p>
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
                  <p className="text-sm text-[#606060] text-center">in the</p>
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
                  <p className="text-sm text-[#606060] text-center">office who went to</p>
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
                        className="px-3 py-2 text-sm text-[#707070] hover:text-[#a0a0a0] transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={handleFilterSearch}
                      disabled={!hasFilters || isSearching}
                      className="flex-1 py-2 text-sm font-medium rounded-lg bg-[#2a2a2a] text-[#c0c0c0] hover:bg-[#333333] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
                <div className="flex items-center gap-2 bg-[#111111] rounded-lg px-3 py-2">
                  <input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAiSubmit();
                      }
                    }}
                    placeholder="Who do you want to find?"
                    disabled={isSearching}
                    className="flex-1 min-w-0 text-sm bg-transparent border-none text-[#c0c0c0] placeholder:text-[#505050] focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleAiSubmit}
                    disabled={!inputValue.trim() || isSearching}
                    className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[#505050] hover:text-[#a0a0a0] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
