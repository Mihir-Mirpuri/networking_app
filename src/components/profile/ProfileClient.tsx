'use client';

import { useState, useEffect, useRef } from 'react';
import { signOut, useSession } from 'next-auth/react';
import {
  getProfileAction,
  updateProfileAction,
  getTemplatesAction,
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
  deleteAccountAction,
  UserProfile,
  TemplateData,
} from '@/app/actions/profile';
import {
  getResumesAction,
  setActiveResumeAction,
  deleteResumeAction,
  ResumeData,
} from '@/app/actions/resume';
import {
  createCheckoutSession,
  createCustomerPortalSession,
} from '@/app/actions/subscription';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { UNIVERSITIES } from '@/lib/constants';

type ProfileTab = 'account' | 'resumes' | 'templates';

interface ProfileClientProps {
  userEmail: string;
  userName: string;
  userImage: string;
  activeTab?: ProfileTab;
}

const DEFAULT_TEMPLATES = [
  {
    id: '__coffee_chat__',
    name: 'Coffee Chat Request',
    subject: '{university} {classification} interested in {industry} at {company}',
    body: `Hi {first_name},

I hope you are doing well. My name is {user_name} and I am a {classification} pursuing my {major} at {university}. I am interested in {career} and would love to grab 10-15 minutes on the phone with you to hear about your experiences at {company}.

In case it's helpful to provide more context on my background, I have attached my resume below for your reference. I look forward to hearing from you.

Warm regards,
{user_name}`,
  },
  {
    id: '__interview_thank_you__',
    name: 'Interview Thank You Note',
    subject: 'Thank you for the interview - {role} at {company}',
    body: `Hi {first_name},

Thank you for taking the time to tell me about the {role} position at {company} and for the opportunity to interview {interview_date}.

I especially enjoyed learning about {topics_discussed}. It was great getting a clearer picture of what the role actually looks like day-to-day.

Please let me know if there's anything else I can provide. Hope you have a great rest of your week!

Best,
{user_name}`,
  },
];

// Comprehensive placeholder list with cohesive naming (category_name format)
const PLACEHOLDER_CATEGORIES = [
  {
    name: 'Recipient',
    prefix: 'recipient',
    placeholders: [
      { key: '{recipient_first_name}', label: 'recipient_first_name', description: 'The recipient\'s first name' },
      { key: '{recipient_last_name}', label: 'recipient_last_name', description: 'The recipient\'s last name' },
      { key: '{recipient_full_name}', label: 'recipient_full_name', description: 'The recipient\'s full name' },
      { key: '{recipient_company}', label: 'recipient_company', description: 'The company where the recipient works' },
      { key: '{recipient_role}', label: 'recipient_role', description: 'The recipient\'s job title or position' },
      { key: '{recipient_department}', label: 'recipient_department', description: 'The department where they work' },
      { key: '{recipient_location}', label: 'recipient_location', description: 'The recipient\'s city or location' },
    ],
  },
  {
    name: 'Sender',
    prefix: 'sender',
    placeholders: [
      { key: '{sender_name}', label: 'sender_name', description: 'Your full name' },
      { key: '{sender_university}', label: 'sender_university', description: 'Your university or school name' },
      { key: '{sender_year}', label: 'sender_year', description: 'Your year (e.g., Junior, Senior)' },
      { key: '{sender_major}', label: 'sender_major', description: 'Your major or field of study' },
      { key: '{sender_minor}', label: 'sender_minor', description: 'Your minor if applicable' },
      { key: '{sender_graduation}', label: 'sender_graduation', description: 'Your expected graduation year' },
      { key: '{sender_gpa}', label: 'sender_gpa', description: 'Your GPA if you want to include it' },
      { key: '{sender_phone}', label: 'sender_phone', description: 'Your phone number' },
      { key: '{sender_linkedin}', label: 'sender_linkedin', description: 'Your LinkedIn profile URL' },
    ],
  },
  {
    name: 'Career',
    prefix: 'career',
    placeholders: [
      { key: '{career_field}', label: 'career_field', description: 'The career field you\'re interested in' },
      { key: '{career_industry}', label: 'career_industry', description: 'The target industry' },
      { key: '{career_role}', label: 'career_role', description: 'The specific role you\'re applying for' },
      { key: '{career_team}', label: 'career_team', description: 'The specific team you\'re interested in' },
      { key: '{career_type}', label: 'career_type', description: 'Full-time, internship, co-op, etc.' },
      { key: '{career_start}', label: 'career_start', description: 'When you can start the position' },
    ],
  },
  {
    name: 'Interview',
    prefix: 'interview',
    placeholders: [
      { key: '{interview_date}', label: 'interview_date', description: 'The date of the interview' },
      { key: '{interview_time}', label: 'interview_time', description: 'The time of the interview' },
      { key: '{interview_interviewer}', label: 'interview_interviewer', description: 'Name of the interviewer' },
      { key: '{interview_topics}', label: 'interview_topics', description: 'Topics discussed during the interview' },
      { key: '{interview_next_steps}', label: 'interview_next_steps', description: 'Agreed upon next steps' },
      { key: '{interview_follow_up}', label: 'interview_follow_up', description: 'When to follow up' },
    ],
  },
  {
    name: 'Experience',
    prefix: 'experience',
    placeholders: [
      { key: '{experience_relevant}', label: 'experience_relevant', description: 'Your relevant experience for this role' },
      { key: '{experience_skills}', label: 'experience_skills', description: 'Your key skills' },
      { key: '{experience_achievements}', label: 'experience_achievements', description: 'Notable achievements' },
      { key: '{experience_projects}', label: 'experience_projects', description: 'Relevant projects you\'ve worked on' },
      { key: '{experience_certifications}', label: 'experience_certifications', description: 'Your certifications' },
    ],
  },
  {
    name: 'Connection',
    prefix: 'connection',
    placeholders: [
      { key: '{connection_mutual}', label: 'connection_mutual', description: 'A mutual connection you share' },
      { key: '{connection_referral}', label: 'connection_referral', description: 'Person who referred you' },
      { key: '{connection_event}', label: 'connection_event', description: 'Event where you met or heard of them' },
      { key: '{connection_interest}', label: 'connection_interest', description: 'A shared interest you have' },
    ],
  },
  {
    name: 'Scheduling',
    prefix: 'scheduling',
    placeholders: [
      { key: '{scheduling_availability}', label: 'scheduling_availability', description: 'Your available times' },
      { key: '{scheduling_duration}', label: 'scheduling_duration', description: 'Suggested meeting length' },
      { key: '{scheduling_timezone}', label: 'scheduling_timezone', description: 'Your timezone' },
      { key: '{scheduling_deadline}', label: 'scheduling_deadline', description: 'Application or response deadline' },
    ],
  },
];

// Flatten for backward compatibility
const DEFAULT_PLACEHOLDERS = PLACEHOLDER_CATEGORIES.flatMap(cat => cat.placeholders.map(p => p.key));

// ─── Draggable Placeholder Pill ────────────────────────────────────────────────

interface DraggablePillProps {
  placeholderKey: string;
  label: string;
  isSelected: boolean;
  onToggle: () => void;
}

function DraggablePill({ placeholderKey, label, isSelected, onToggle }: DraggablePillProps) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', placeholderKey);
    e.dataTransfer.setData('application/x-placeholder', placeholderKey);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleInsert = (e: React.MouseEvent) => {
    e.preventDefault();
    if (activePlaceholderInsert) {
      activePlaceholderInsert(placeholderKey);
    }
  };

  const handleInfo = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  };

  return (
    <span
      draggable
      onDragStart={handleDragStart}
      className={`group inline-flex items-stretch rounded-md text-[11px] font-medium transition-all cursor-grab active:cursor-grabbing select-none border ${
        isSelected
          ? 'bg-[#6364FF]/20 border-[#6364FF]/60 text-white'
          : 'bg-[#6364FF]/10 border-[#6364FF]/30 text-[#a5a6ff] hover:bg-[#6364FF]/20 hover:border-[#6364FF]/55 hover:text-white'
      }`}
      title="Click to insert · drag to position · ⓘ for details"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleInsert}
        className="pl-2.5 pr-1.5 py-[3px] rounded-l-md"
      >
        {label}
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleInfo}
        aria-label={`About ${label}`}
        className="pr-2 pl-1 py-[3px] opacity-60 hover:opacity-100 rounded-r-md border-l border-[#6364FF]/25 flex items-center"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 11v5M12 8h.01" />
        </svg>
      </button>
    </span>
  );
}

// ─── Shared pill utilities ─────────────────────────────────────────────────────

const PILL_STYLE = 'display:inline-flex;align-items:center;gap:4px;padding:1px 5px 1px 8px;margin:0 2px;border-radius:6px;font-size:12px;font-weight:500;background:rgba(99,100,255,0.12);border:1px solid rgba(99,100,255,0.35);color:#a5a6ff;white-space:nowrap;vertical-align:baseline;cursor:grab;';

const PILL_X_STYLE = 'display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:rgba(99,100,255,0.2);color:#a5a6ff;cursor:pointer;font-size:10px;line-height:1;margin-left:2px;';

function textToHtml(text: string, multiline: boolean = true): string {
  if (!text) return '';
  let result = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (multiline) {
    result = result.replace(/\n/g, '<br>');
  }

  return result.replace(
    /\{([^}]+)\}/g,
    `<span class="pill-placeholder" draggable="true" contenteditable="false" data-placeholder="{$1}" style="${PILL_STYLE}"><span class="pill-text">$1</span><span class="pill-remove" style="${PILL_X_STYLE}">×</span></span>`
  );
}

function htmlToText(element: HTMLElement): string {
  let result = '';
  const processNode = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains('pill-placeholder')) {
        result += el.getAttribute('data-placeholder') || '';
      } else if (el.classList.contains('pill-text') || el.classList.contains('pill-remove')) {
        // Skip - handled by parent pill-placeholder
      } else if (el.tagName === 'BR') {
        result += '\n';
      } else if (el.tagName === 'DIV' && result.length > 0 && !result.endsWith('\n')) {
        result += '\n';
        el.childNodes.forEach(processNode);
      } else {
        el.childNodes.forEach(processNode);
      }
    }
  };
  element.childNodes.forEach(processNode);
  return result;
}

function createPillElement(placeholderKey: string): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.className = 'pill-placeholder';
  pill.draggable = true;
  pill.contentEditable = 'false';
  pill.setAttribute('data-placeholder', placeholderKey);
  pill.setAttribute('style', PILL_STYLE);

  const textSpan = document.createElement('span');
  textSpan.className = 'pill-text';
  textSpan.textContent = placeholderKey.slice(1, -1); // Remove { and }

  const removeSpan = document.createElement('span');
  removeSpan.className = 'pill-remove';
  removeSpan.setAttribute('style', PILL_X_STYLE);
  removeSpan.textContent = '×';

  pill.appendChild(textSpan);
  pill.appendChild(removeSpan);
  return pill;
}

// ─── Single-line Pill Input (for subject) ──────────────────────────────────────

interface PillInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// Track pill being dragged from within editors
let draggingPill: HTMLElement | null = null;

// Track the last-focused editor so sidebar clicks can insert into it.
// Set when a PillInput/PillEditor focuses; intentionally not cleared on blur
// (clicking the sidebar blurs the editor, but we still want that click to target it).
let activePlaceholderInsert: ((placeholderKey: string) => void) | null = null;

function insertPillAtCursor(
  editorRef: React.RefObject<HTMLDivElement>,
  placeholderKey: string,
  onAfterInsert: () => void,
) {
  const el = editorRef.current;
  if (!el) return;
  el.focus();
  const selection = window.getSelection();
  let range: Range;
  if (
    selection &&
    selection.rangeCount > 0 &&
    selection.anchorNode &&
    el.contains(selection.anchorNode)
  ) {
    range = selection.getRangeAt(0).cloneRange();
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  const pill = createPillElement(placeholderKey);
  range.insertNode(pill);
  const newRange = document.createRange();
  newRange.setStartAfter(pill);
  newRange.setEndAfter(pill);
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(newRange);
  }
  onAfterInsert();
}

function PillInput({ value, onChange, placeholder }: PillInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const syncFromValue = () => {
    if (editorRef.current) {
      editorRef.current.innerHTML = textToHtml(value, false);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      const newText = htmlToText(editorRef.current).replace(/\n/g, ' ');
      onChange(newText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\n/g, ' ');
    document.execCommand('insertText', false, text);
  };

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('pill-remove')) {
      e.preventDefault();
      e.stopPropagation();
      const pill = target.closest('.pill-placeholder');
      if (pill) {
        pill.remove();
        handleInput();
      }
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    const pill = target.closest('.pill-placeholder') as HTMLElement;
    if (pill) {
      const placeholderKey = pill.getAttribute('data-placeholder') || '';
      e.dataTransfer.setData('text/plain', placeholderKey);
      e.dataTransfer.setData('application/x-placeholder', placeholderKey);
      e.dataTransfer.effectAllowed = 'move';
      draggingPill = pill;
    }
  };

  const handleDragEnd = () => {
    draggingPill = null;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const placeholderKey = e.dataTransfer.getData('application/x-placeholder') || e.dataTransfer.getData('text/plain');
    if (placeholderKey && placeholderKey.startsWith('{') && editorRef.current) {
      // Remove the original pill if it's a move operation
      if (draggingPill && editorRef.current.contains(draggingPill)) {
        draggingPill.remove();
      }
      draggingPill = null;

      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && editorRef.current.contains(range.startContainer)) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
          const pill = createPillElement(placeholderKey);
          range.insertNode(pill);
          range.setStartAfter(pill);
          range.setEndAfter(pill);
          selection.removeAllRanges();
          selection.addRange(range);
          handleInput();
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Show caret at drop position
    if (editorRef.current) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && editorRef.current.contains(range.startContainer)) {
        // If hovering over a pill, place caret before it
        const pill = (e.target as HTMLElement).closest?.('.pill-placeholder');
        if (pill && pill.parentNode) {
          const newRange = document.createRange();
          newRange.setStartBefore(pill);
          newRange.setEndBefore(pill);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } else {
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    }
  };

  useEffect(() => {
    if (!isFocused) {
      syncFromValue();
    }
  }, [value, isFocused]);

  useEffect(() => {
    syncFromValue();
  }, []);

  return (
    <div className="flex-1 relative">
      {!value && !isFocused && (
        <div className="absolute inset-0 text-[13px] text-[#3a3a3a] pointer-events-none select-none">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onFocus={() => {
          setIsFocused(true);
          activePlaceholderInsert = (key) => insertPillAtCursor(editorRef, key, handleInput);
        }}
        onBlur={() => { setIsFocused(false); syncFromValue(); }}
        onPaste={handlePaste}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="text-[13px] text-white outline-none border-none ring-0 focus:outline-none focus:border-none focus:ring-0 whitespace-nowrap overflow-x-auto"
        style={{ minHeight: '1.5em', caretColor: '#6364FF', boxShadow: 'none' }}
      />
    </div>
  );
}

// ─── Multi-line Pill Editor (for body) ─────────────────────────────────────────

interface PillEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function PillEditor({ value, onChange, placeholder }: PillEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const syncFromValue = () => {
    if (editorRef.current) {
      editorRef.current.innerHTML = textToHtml(value, true);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      const newText = htmlToText(editorRef.current);
      onChange(newText);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('pill-remove')) {
      e.preventDefault();
      e.stopPropagation();
      const pill = target.closest('.pill-placeholder');
      if (pill) {
        pill.remove();
        handleInput();
      }
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    const pill = target.closest('.pill-placeholder') as HTMLElement;
    if (pill) {
      const placeholderKey = pill.getAttribute('data-placeholder') || '';
      e.dataTransfer.setData('text/plain', placeholderKey);
      e.dataTransfer.setData('application/x-placeholder', placeholderKey);
      e.dataTransfer.effectAllowed = 'move';
      draggingPill = pill;
    }
  };

  const handleDragEnd = () => {
    draggingPill = null;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const placeholderKey = e.dataTransfer.getData('application/x-placeholder') || e.dataTransfer.getData('text/plain');
    if (placeholderKey && placeholderKey.startsWith('{') && editorRef.current) {
      // Remove the original pill if it's a move operation
      if (draggingPill && editorRef.current.contains(draggingPill)) {
        draggingPill.remove();
      }
      draggingPill = null;

      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && editorRef.current.contains(range.startContainer)) {
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
          const pill = createPillElement(placeholderKey);
          range.insertNode(pill);
          range.setStartAfter(pill);
          range.setEndAfter(pill);
          selection.removeAllRanges();
          selection.addRange(range);
          handleInput();
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Show caret at drop position
    if (editorRef.current) {
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range && editorRef.current.contains(range.startContainer)) {
        // If hovering over a pill, place caret before it
        const pill = (e.target as HTMLElement).closest?.('.pill-placeholder');
        if (pill && pill.parentNode) {
          const newRange = document.createRange();
          newRange.setStartBefore(pill);
          newRange.setEndBefore(pill);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(newRange);
          }
        } else {
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
      }
    }
  };

  useEffect(() => {
    if (!isFocused) {
      syncFromValue();
    }
  }, [value, isFocused]);

  useEffect(() => {
    syncFromValue();
  }, []);

  return (
    <div className="relative h-full">
      {!value && !isFocused && (
        <div className="absolute inset-0 text-sm text-[#3a3a3a] leading-[1.7] pointer-events-none select-none">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onClick={handleClick}
        onFocus={() => {
          setIsFocused(true);
          activePlaceholderInsert = (key) => insertPillAtCursor(editorRef, key, handleInput);
        }}
        onBlur={() => { setIsFocused(false); syncFromValue(); }}
        onPaste={handlePaste}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="w-full h-full min-h-[300px] text-sm text-white leading-[1.7] outline-none border-none ring-0 focus:outline-none focus:border-none focus:ring-0"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', caretColor: '#6364FF', boxShadow: 'none' }}
      />
    </div>
  );
}

// ─── Placeholders Sidebar ─────────────────────────────────────────────────────

function PlaceholdersSidebar() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPill, setExpandedPill] = useState<string | null>(null);

  // Filter placeholders based on search query
  const filteredCategories = PLACEHOLDER_CATEGORIES.map(category => ({
    ...category,
    placeholders: category.placeholders.filter(p =>
      searchQuery === '' ||
      p.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(category => category.placeholders.length > 0);

  const handlePillToggle = (key: string) => {
    setExpandedPill(prev => prev === key ? null : key);
  };

  const totalCount = filteredCategories.reduce((n, c) => n + c.placeholders.length, 0);

  return (
    <div className="flex flex-col h-full w-80 bg-[#141414] border-r border-[#2a2a2a] relative">
      {/* subtle ambient accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(400px 200px at 50% -10%, rgba(99,100,255,0.05), transparent 70%)' }}
      />

      {/* Header — eyebrow style, matching main editor */}
      <div className="relative px-5 pt-6 pb-4">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inset-0 rounded-full bg-[#6364FF] animate-ping opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#6364FF]" />
          </span>
          <span className="text-[11px] uppercase tracking-[0.1em] text-[#606060]">Placeholders</span>
          <span className="ml-auto text-[10px] text-[#505050] tabular-nums">{totalCount}</span>
        </div>

        {/* Title */}
        <h3 className="text-[20px] leading-tight tracking-[-0.01em] text-white font-[family-name:var(--font-outfit)] font-normal">
          Drag to insert
        </h3>
        <p className="mt-1 text-[12px] text-[#606060] leading-relaxed">
          Tap a pill for its definition, or drag it into the subject or body.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative px-5 pb-4">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#505050]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search placeholders"
            className="w-full pl-9 pr-8 py-2 text-[12px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-white placeholder-[#505050] outline-none focus:border-[#6364FF] focus:ring-2 focus:ring-[#6364FF]/15 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#505050] hover:text-white transition-colors"
              aria-label="Clear search"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Accent rule matching the main editor */}
      <div
        className="relative h-px mx-5"
        style={{ background: 'linear-gradient(90deg, #6364FF 0%, #6364FF 36px, #2a2a2a 36px, #2a2a2a 100%)' }}
      />

      {/* Placeholders content */}
      <div className="relative flex-1 overflow-y-auto px-5 pt-5 pb-6">
        {filteredCategories.map((category) => {
          const selectedInCategory = category.placeholders.find(p => p.key === expandedPill);

          return (
            <div key={category.name} className="mb-5 last:mb-0">
              <div className="flex items-center gap-2.5 mb-2.5">
                <h4 className="text-[10px] font-medium text-[#606060] uppercase tracking-[0.18em]">
                  {category.name}
                </h4>
                <div className="flex-1 h-px bg-gradient-to-r from-[#2a2a2a] to-transparent" />
                <span className="text-[10px] text-[#404040] tabular-nums">{category.placeholders.length}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {category.placeholders.map((placeholder) => (
                  <DraggablePill
                    key={placeholder.key}
                    placeholderKey={placeholder.key}
                    label={placeholder.label}
                    isSelected={expandedPill === placeholder.key}
                    onToggle={() => handlePillToggle(placeholder.key)}
                  />
                ))}
              </div>
              {selectedInCategory && (
                <div className="mt-3 px-3 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
                  <p className="text-[11px] text-[#d0d0d0] leading-relaxed">
                    {selectedInCategory.description}
                  </p>
                </div>
              )}
            </div>
          );
        })}

        {filteredCategories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="w-10 h-10 rounded-full border border-dashed border-[#2a2a2a] flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-[#404040]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <p className="text-[12px] text-[#606060]">No placeholders match</p>
            <p className="text-[11px] text-[#404040] mt-0.5">&ldquo;{searchQuery}&rdquo;</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfileClient({ userEmail, userName, userImage, activeTab }: ProfileClientProps) {
  const { status } = useSession();

  // Profile state
  const [profile, setProfile] = useState<UserProfile>({
    name: userName,
    classification: null,
    major: null,
    university: null,
    career: null,
    emailInstructions: null,
    autoPersonalize: false,
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileLoadedRef = useRef(false);

  // Templates state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<TemplateData | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Resume state
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [isLoadingResumes, setIsLoadingResumes] = useState(true);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeSuccess, setResumeSuccess] = useState(false);
  const [expandedResume, setExpandedResume] = useState<ResumeData | null>(null);
  const [showEmailPrefs, setShowEmailPrefs] = useState(false);
  const [loadedPdfs, setLoadedPdfs] = useState<Set<string>>(new Set());

  // Subscription state (from shared context)
  const { isSubscribed: ctxIsSubscribed, currentPeriodEnd, isLoading: isLoadingSubscription } = useSubscription();
  const subscription = {
    isSubscribed: ctxIsSubscribed ?? false,
    currentPeriodEnd: currentPeriodEnd ?? null,
  };
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  // Delete account state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    if (status === 'authenticated') {
      loadProfile();
      loadTemplates();
      loadResumes();
    }
  }, [status]);

  const loadProfile = async () => {
    setIsLoadingProfile(true);
    const result = await getProfileAction();
    if (result.success) {
      setProfile(result.profile);
      // Mark loaded so auto-save doesn't fire on initial load
      setTimeout(() => { profileLoadedRef.current = true; }, 0);
    }
    setIsLoadingProfile(false);
  };

  const loadTemplates = async () => {
    setIsLoadingTemplates(true);
    const result = await getTemplatesAction();
    if (result.success) {
      setTemplates(result.templates);
    }
    setIsLoadingTemplates(false);
  };

  const loadResumes = async () => {
    setIsLoadingResumes(true);
    const result = await getResumesAction();
    if (result.success) {
      setResumes(result.resumes);
    }
    setIsLoadingResumes(false);
  };

  // Auto-save profile on change (debounced)
  useEffect(() => {
    if (!profileLoadedRef.current) return;
    setProfileError(null);
    const timeout = setTimeout(async () => {
      const result = await updateProfileAction(profile);
      if (!result.success) {
        setProfileError(result.error);
      }
    }, 600);
    return () => clearTimeout(timeout);
  }, [profile]);

  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return;

    setIsSavingTemplate(true);
    setTemplateError(null);

    const result = await updateTemplateAction(editingTemplate.id, {
      name: editingTemplate.name,
      subject: editingTemplate.subject,
      body: editingTemplate.body,
      attachResume: editingTemplate.attachResume,
      resumeId: editingTemplate.resumeId,
    });

    if (result.success) {
      setTemplates(
        templates.map((t) => (t.id === editingTemplate.id ? editingTemplate : t))
      );
      setEditingTemplate(null);
    } else {
      setTemplateError(result.error);
    }
    setIsSavingTemplate(false);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    const result = await deleteTemplateAction(id);
    if (result.success) {
      setTemplates(templates.filter((t) => t.id !== id));
    } else {
      setTemplateError(result.error);
    }
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: '/app' });
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;

    setIsDeletingAccount(true);
    const result = await deleteAccountAction();

    if (result.success) {
      // Sign out and redirect to home
      signOut({ callbackUrl: '/' });
    } else {
      setIsDeletingAccount(false);
      setProfileError(result.error);
    }
  };

  const handleUploadResume = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingResume(true);
    setResumeError(null);
    setResumeSuccess(false);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/resume/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let message = 'Failed to upload resume';
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {
          // Response body was empty or not JSON (e.g. 413 from Next.js)
          if (response.status === 413) {
            message = 'File is too large to upload';
          }
        }
        throw new Error(message);
      }

      const data = await response.json();

      setResumeSuccess(true);
      setTimeout(() => setResumeSuccess(false), 3000);
      await loadResumes();

      event.target.value = '';
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'Failed to upload resume');
    } finally {
      setIsUploadingResume(false);
    }
  };

  const handleSetActiveResume = async (resumeId: string) => {
    const result = await setActiveResumeAction(resumeId);
    if (result.success) {
      await loadResumes();
    } else {
      setResumeError(result.error);
    }
  };

  const handleDeleteResume = async (resumeId: string) => {
    if (!confirm('Are you sure you want to delete this resume?')) return;

    const result = await deleteResumeAction(resumeId);
    if (result.success) {
      await loadResumes();
    } else {
      setResumeError(result.error);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    return new Date(date).toLocaleDateString();
  };

  const initials = (profile.name || userName || userEmail || '?')
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const TAB_TITLES: Record<string, { title: string; subtitle: string }> = {
    account: { title: 'Account', subtitle: 'Manage your profile, plan, and account' },
    resumes: { title: 'Attachments', subtitle: 'Upload and manage files to personalize your outreach' },
    templates: { title: 'Templates', subtitle: 'Browse and manage your email templates' },
  };

  const currentTab = activeTab || 'account';
  const tabInfo = TAB_TITLES[currentTab] || TAB_TITLES.account;

  return (
    <div className="text-white px-8 sm:px-10 pt-4 pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{tabInfo.title}</h1>
          <p className="text-white text-[13px] mt-1">{tabInfo.subtitle}</p>
        </div>
        {currentTab === 'resumes' && (
          <label className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors cursor-pointer flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {isUploadingResume ? 'Uploading...' : 'Upload File'}
            <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadResume} disabled={isUploadingResume} className="hidden" />
          </label>
        )}
        {currentTab === 'templates' && (
          <button
            onClick={() => setShowEmailPrefs(true)}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Email Preferences
          </button>
        )}
      </header>


      {profileError && (
        <div className="mb-6 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">
          {profileError}
        </div>
      )}

      <div className="space-y-6">

        {/* Account Section — Bento Layout */}
        {currentTab === 'account' && (
        <div className="flex flex-col gap-4">
          {isLoadingProfile || isLoadingSubscription ? (
            <div className="animate-pulse space-y-4">
              <div className="flex gap-4">
                <div className="flex-1 h-64 bg-[#252525] rounded-xl" />
                <div className="flex-1 flex flex-col gap-4">
                  <div className="flex-1 h-28 bg-[#252525] rounded-xl" />
                  <div className="flex-1 h-28 bg-[#252525] rounded-xl" />
                </div>
              </div>
              <div className="h-16 bg-[#252525] rounded-xl" />
            </div>
          ) : (
            <>
              {/* Bento grid — top */}
              <div className="flex gap-4" style={{ minHeight: 280 }}>
                {/* Profile card — left */}
                <div className="flex-1 bg-[#252525] border border-[#3a3a3a] rounded-xl p-8 flex flex-col items-center justify-center gap-4">
                  {userImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={userImage} alt={userName} className="w-24 h-24 rounded-full ring-2 ring-[#303030]" />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-[#6364FF] flex items-center justify-center text-2xl font-bold text-white">
                      {(profile.name || userName || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                  )}
                  <span className="text-2xl font-bold text-white">{profile.name || userName}</span>
                  <span className="text-sm text-[#707070]">{userEmail}</span>
                  {/* University chip */}
                  <div className="relative">
                    <SearchableCombobox
                      options={UNIVERSITIES}
                      value={profile.university || ''}
                      onChange={(value) => setProfile({ ...profile, university: value })}
                      label=""
                      placeholder="Select university..."
                      id="university-bento"
                    />
                  </div>
                  {/* Plan badge */}
                  <span className={`px-3.5 py-1.5 rounded-full text-xs font-semibold ${
                    subscription.isSubscribed
                      ? 'bg-[#6364FF]/15 text-[#6364FF]'
                      : 'bg-[#303030] text-white'
                  }`}>
                    {subscription.isSubscribed ? 'PRO Plan' : 'Free Plan'}
                  </span>
                </div>

                {/* Right stack */}
                <div className="flex-1 flex flex-col gap-4">
                  {/* Subscription tile */}
                  <div className="flex-1 bg-[#252525] border border-[#3a3a3a] rounded-xl p-6 flex flex-col gap-4">
                    <svg className="w-6 h-6 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
                    </svg>
                    <div>
                      <h3 className="text-[15px] font-semibold text-white">Subscription</h3>
                      <p className="text-xs text-[#707070] mt-1">
                        {subscription.isSubscribed
                          ? `$20/month · Renews ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'soon'}`
                          : '10 emails/day · Free forever'}
                      </p>
                    </div>
                    <div className="flex-1" />
                    {subscription.isSubscribed ? (
                      <button
                        onClick={async () => { setIsPortalLoading(true); try { await createCustomerPortalSession(); } catch { setIsPortalLoading(false); } }}
                        disabled={isPortalLoading}
                        className="w-full py-2.5 bg-[#6364FF] text-white text-xs font-semibold rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
                      >
                        {isPortalLoading ? 'Loading...' : 'Manage Plan'}
                      </button>
                    ) : (
                      <button
                        onClick={async () => { setIsCheckoutLoading(true); try { await createCheckoutSession(); } catch { setIsCheckoutLoading(false); } }}
                        disabled={isCheckoutLoading}
                        className="w-full py-2.5 bg-[#6364FF] text-white text-xs font-semibold rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
                      >
                        {isCheckoutLoading ? 'Loading...' : 'Upgrade to Pro'}
                      </button>
                    )}
                  </div>

                  {/* Feedback tile */}
                  <div className="flex-1 bg-[#252525] border border-[#3a3a3a] rounded-xl p-6 flex flex-col gap-4">
                    <svg className="w-6 h-6 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
                    </svg>
                    <div>
                      <h3 className="text-[15px] font-semibold text-white">Feedback</h3>
                      <p className="text-xs text-[#707070] mt-1">Share your thoughts with us</p>
                    </div>
                    <div className="flex-1" />
                    <a
                      href="mailto:feedback@signl.to"
                      className="w-full py-2.5 border border-[#3a3a3a] text-white text-xs font-semibold rounded-lg hover:bg-[#303030] transition-colors text-center block"
                    >
                      Send Email
                    </a>
                  </div>
                </div>
              </div>

              {/* Delete row — bottom */}
              <div className="bg-[#252525] border border-[#ef4444]/25 rounded-xl px-6 py-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Delete Account</h3>
                    <p className="text-xs text-[#707070]">Permanently remove your account and all data</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-xs font-semibold text-[#ef4444] border border-[#ef4444]/40 rounded-lg px-5 py-2.5 hover:bg-[#ef4444]/10 transition-colors"
                >
                  Delete
                </button>
              </div>

              {/* Delete Account Confirmation Modal */}
              {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                  <div className="bg-[#1a1a1a] border border-[#3a3a3a] rounded-xl p-6 max-w-md w-full mx-4">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-[#ef4444]/20 flex items-center justify-center">
                        <svg className="w-5 h-5 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">Delete Account</h3>
                        <p className="text-sm text-[#707070]">This action cannot be undone</p>
                      </div>
                    </div>

                    <p className="text-sm text-[#a0a0a0] mb-4">
                      This will permanently delete your account and all associated data including:
                    </p>
                    <ul className="text-sm text-[#a0a0a0] mb-4 list-disc list-inside space-y-1">
                      <li>Your profile and preferences</li>
                      <li>All saved contacts and outreach history</li>
                      <li>Email templates and drafts</li>
                      <li>Uploaded resumes</li>
                    </ul>

                    <p className="text-sm text-white mb-2">
                      Type <span className="font-mono bg-[#2a2a2a] px-1.5 py-0.5 rounded text-[#ef4444]">DELETE</span> to confirm:
                    </p>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="Type DELETE"
                      className="w-full px-3 py-2 bg-[#252525] border border-[#3a3a3a] rounded-lg text-white text-sm mb-4 focus:outline-none focus:border-[#ef4444]/50"
                      disabled={isDeletingAccount}
                    />

                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmText('');
                        }}
                        disabled={isDeletingAccount}
                        className="flex-1 py-2.5 border border-[#3a3a3a] text-white text-sm font-semibold rounded-lg hover:bg-[#303030] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteAccount}
                        disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                        className="flex-1 py-2.5 bg-[#ef4444] text-white text-sm font-semibold rounded-lg hover:bg-[#dc2626] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {isDeletingAccount ? (
                          <>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Deleting...
                          </>
                        ) : (
                          'Delete Account'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}


        {/* Attachments Grid — kept mounted so PDF objects don't re-fetch */}
        <div className={currentTab === 'resumes' ? '' : 'hidden'}>
          {resumeSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-900/30 text-green-400 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              File uploaded successfully!
            </div>
          )}
          {resumeError && (
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">{resumeError}</div>
          )}

          {isLoadingResumes ? (
            <div className="text-center py-12 text-white text-sm">Loading attachments...</div>
          ) : resumes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#252525] flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <p className="text-white text-sm font-medium mb-1">No attachments yet</p>
              <p className="text-white text-xs">Upload resumes, cover letters, or other files</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {resumes.map((resume) => (
                <div key={resume.id} className="group flex flex-col items-center gap-2">
                  {/* Document thumbnail */}
                  <div
                    className={`relative w-full aspect-[3/4] rounded-md bg-[#F5F5F5] overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                      resume.isActive
                        ? 'ring-2 ring-[#6364FF] shadow-[0_2px_12px_rgba(99,100,255,0.15)]'
                        : 'hover:ring-1 hover:ring-[#505050]'
                    }`}
                    onClick={() => setExpandedResume(resume)}
                  >
                    {/* PDF thumbnail with spinner until loaded */}
                    {resume.mimeType === 'application/pdf' ? (
                      <>
                        {!loadedPdfs.has(resume.id) && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#F5F5F5] z-[1]">
                            <div className="w-5 h-5 border-2 border-[#6364FF]/30 border-t-[#6364FF] rounded-full animate-spin" />
                          </div>
                        )}
                        <object
                          data={`/api/resume/view?id=${resume.id}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                          type="application/pdf"
                          className={`w-full h-full pointer-events-none transition-opacity duration-500 ${loadedPdfs.has(resume.id) ? 'opacity-100' : 'opacity-0'}`}
                          title={resume.filename}
                          onLoad={() => setLoadedPdfs(prev => new Set(prev).add(resume.id))}
                        >
                          <div className="w-full h-full" />
                        </object>
                      </>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[#F5F5F5] p-3">
                        <svg className="w-10 h-10 text-[#6364FF] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="text-[10px] text-[#1a1a1a] font-medium text-center truncate max-w-full px-2">{resume.filename}</span>
                        <span className="text-[9px] text-[#666] mt-1">{resume.filename.split('.').pop()?.toUpperCase()}</span>
                      </div>
                    )}

                    {/* Hover overlay with actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteResume(resume.id); }}
                        className="p-2 bg-[#ef4444]/80 rounded-lg text-white hover:bg-[#ef4444] transition-colors"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Filename */}
                  <p className="text-[11px] text-white font-medium truncate max-w-full text-center">{resume.filename}</p>

                  {/* Active badge */}
                  {resume.isActive && (
                    <span className="text-[9px] font-semibold text-[#6364FF] bg-[#6364FF]/15 px-2.5 py-0.5 rounded-full">Active</span>
                  )}
                </div>
              ))}

            </div>
          )}
        </div>

        {/* Templates Table */}
        {currentTab === 'templates' && (
        <div>
          {templateError && (
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {templateError}
            </div>
          )}

          {isLoadingTemplates ? (
            <div className="text-center py-12 text-white text-sm">Loading templates...</div>
          ) : (() => {
            const defaultTemplateItems = DEFAULT_TEMPLATES.map((dt, index) => ({
              id: dt.id,
              name: dt.name,
              subject: dt.subject,
              body: dt.body,
              isDefault: index === 0 && !templates.some(t => t.isDefault),
              attachResume: false,
              resumeId: null,
              createdAt: new Date(),
            } as TemplateData & { id: string }));
            const allTemplates = [
              ...defaultTemplateItems,
              ...templates,
            ];

            return (
              <div className="border border-[#3a3a3a] rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="flex items-center px-5 py-3 border-b border-[#3a3a3a] bg-[#0f0f0f]">
                  <span className="flex-1 text-[11px] font-semibold text-white uppercase tracking-wider">Template</span>
                  <span className="w-8" />
                </div>

                {/* Template rows */}
                {allTemplates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => {
                      const defaultTemplate = DEFAULT_TEMPLATES.find(dt => dt.id === template.id);
                      if (defaultTemplate) {
                        setEditingTemplate({ id: defaultTemplate.id, name: defaultTemplate.name, subject: defaultTemplate.subject, body: defaultTemplate.body, isDefault: template.isDefault, attachResume: false, resumeId: null, createdAt: new Date() });
                      } else {
                        setEditingTemplate(template as TemplateData);
                      }
                    }}
                    className="group flex items-center w-full px-5 py-4 gap-3 border-b border-[#3a3a3a] last:border-b-0 hover:bg-[#1a1a1a] transition-colors text-left"
                  >
                    <div className="p-2 rounded-lg shrink-0 bg-[#6364FF]">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </div>
                    <p className="flex-1 text-[13px] font-medium text-white truncate">{template.name}</p>
                    <svg className="w-4 h-4 text-[#404040] group-hover:text-[#606060] shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                ))}

                {/* New Template Row */}
                <button
                  onClick={() => setEditingTemplate({ id: '__new__', name: '', subject: '', body: '', isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() })}
                  className="group flex items-center w-full px-5 py-4 gap-3 hover:bg-[#1a1a1a] transition-colors text-left"
                >
                  <div className="p-2 rounded-lg shrink-0 bg-[#6364FF]">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-medium text-white">New Template</span>
                </button>
              </div>
            );
          })()}

        </div>
        )}

      </div>

      {/* Full-Screen Template Editor — Letterpress */}
      {editingTemplate && (() => {
        const isDefault = DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id);
        const isNew = editingTemplate.id === '__new__';
        const canDelete = !isDefault && !isNew;
        const charCount = editingTemplate.body.length;
        const readSec = Math.max(1, Math.round(charCount / 17));
        const placeholderCount = (editingTemplate.body.match(/\{\{[^}]+\}\}/g) || []).length
          + (editingTemplate.subject.match(/\{\{[^}]+\}\}/g) || []).length;

        const handleSave = async () => {
          if (!editingTemplate.name.trim() || !editingTemplate.body.trim()) {
            setTemplateError('Template name and body are required');
            return;
          }
          setIsSavingTemplate(true);
          setTemplateError(null);
          if (isNew || isDefault) {
            const result = await createTemplateAction({
              name: editingTemplate.name,
              subject: editingTemplate.subject,
              body: editingTemplate.body,
              attachResume: editingTemplate.attachResume,
              resumeId: editingTemplate.resumeId,
            });
            if (result.success) {
              setTemplates([...templates, result.template]);
              setEditingTemplate(null);
            } else {
              setTemplateError(result.error);
            }
          } else {
            await handleUpdateTemplate();
            if (!templateError) setEditingTemplate(null);
          }
          setIsSavingTemplate(false);
        };

        return (
          <div
            className="fixed inset-0 z-50 flex bg-[#111111] animate-fade-in"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditingTemplate(null);
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSave(); }
            }}
            tabIndex={-1}
          >
            {/* ── Left: Placeholders Sidebar ── */}
            <div className="hidden lg:block flex-shrink-0">
              <PlaceholdersSidebar />
            </div>

            {/* ── Right: Main composition surface ── */}
            <div
              className="flex-1 flex items-center justify-center bg-[#111111] relative overflow-hidden"
              onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingTemplate(null); }}
            >
              {/* ambient accent glow */}
              <div
                className="absolute inset-0 pointer-events-none opacity-60"
                style={{ background: 'radial-gradient(900px 420px at 22% -8%, rgba(99,100,255,0.07), transparent 60%)' }}
              />

              <div
                className="relative w-full max-w-[760px] h-[88vh] max-h-[820px] bg-[#1a1a1a] rounded-2xl border border-[#2a2a2a] flex flex-col overflow-hidden"
                style={{ boxShadow: '0 0 1px rgba(0,0,0,0.4), 0 30px 80px rgba(0,0,0,0.55)' }}
              >
                {/* ── Header region ── */}
                <div className="flex-shrink-0 px-10 pt-7">
                  {/* Eyebrow + actions */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5 text-[11px] uppercase tracking-[0.1em] text-[#606060]">
                      <span>Template</span>
                      <span className="text-[#404040]">·</span>
                      <span className="inline-flex items-center gap-2 text-[#6364FF]">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inset-0 rounded-full bg-[#6364FF] animate-ping opacity-60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#6364FF]" />
                        </span>
                        {isNew ? 'New draft' : isDefault ? 'From preset' : 'Editing'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {canDelete && (
                        <button
                          onClick={() => { handleDeleteTemplate(editingTemplate.id); setEditingTemplate(null); }}
                          aria-label="Delete template"
                          className="w-8 h-8 rounded-lg border border-transparent text-[#606060] hover:text-[#ff6b6b] hover:bg-[#ff6b6b]/10 hover:border-[#ff6b6b]/25 transition-colors flex items-center justify-center"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => setEditingTemplate(null)}
                        aria-label="Close"
                        className="w-8 h-8 rounded-lg border border-transparent text-[#606060] hover:text-white hover:bg-[#252525] hover:border-[#404040] transition-colors flex items-center justify-center"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Editable title */}
                  <input
                    type="text"
                    value={editingTemplate.name}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    placeholder="Untitled template"
                    className="w-full bg-transparent border-none outline-none text-[36px] leading-[1.1] tracking-[-0.02em] text-white placeholder:text-[#404040] font-[family-name:var(--font-outfit)] font-normal"
                    style={{ caretColor: '#6364FF' }}
                    autoFocus={isNew}
                  />

                  {/* Accent rule */}
                  <div
                    className="h-px mt-4 mb-2"
                    style={{ background: 'linear-gradient(90deg, #6364FF 0%, #6364FF 48px, #2a2a2a 48px, #2a2a2a 100%)' }}
                  />

                  {/* Subject field */}
                  <div className="flex items-baseline gap-5 py-3 border-b border-dashed border-[#2a2a2a]">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[#606060] w-16 flex-shrink-0">Subject</span>
                    <div className="flex-1">
                      <PillInput
                        value={editingTemplate.subject}
                        onChange={(newSubject) => setEditingTemplate({ ...editingTemplate, subject: newSubject })}
                        placeholder="Email subject..."
                      />
                    </div>
                  </div>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto px-10 py-6">
                  <PillEditor
                    value={editingTemplate.body}
                    onChange={(newBody) => setEditingTemplate({ ...editingTemplate, body: newBody })}
                    placeholder="Write your email template here. Drag placeholders from the sidebar to personalize..."
                  />
                </div>

                {/* Error */}
                {templateError && (
                  <div className="px-10 py-2.5 bg-red-900/15 border-t border-red-900/25 flex-shrink-0">
                    <p className="text-[12px] text-red-400">{templateError}</p>
                  </div>
                )}

                {/* ── Footer ── */}
                <div className="flex-shrink-0 flex items-center justify-between px-10 py-4 border-t border-[#2a2a2a] bg-[#141414]">
                  <div className="flex items-center gap-5 text-[11px] text-[#606060]">
                    <span><span className="text-[#b0b0b0] font-medium">{placeholderCount}</span> placeholders</span>
                    <span className="text-[#303030]">·</span>
                    <span><span className="text-[#b0b0b0] font-medium">{charCount}</span> chars</span>
                    <span className="text-[#303030]">·</span>
                    <span>~<span className="text-[#b0b0b0] font-medium">{readSec}s</span> read</span>
                    <span className="lg:hidden text-[#404040]">·</span>
                    <span className="lg:hidden">Use sidebar for placeholders</span>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={isSavingTemplate}
                    className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-full text-[13px] font-semibold text-white bg-[#6364FF] hover:bg-[#7879ff] transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px"
                    style={{ boxShadow: '0 0 0 1px rgba(99,100,255,0.3), 0 8px 24px rgba(99,100,255,0.25)' }}
                  >
                    {isSavingTemplate ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Saving
                      </>
                    ) : (
                      <>
                        Save template
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 font-medium tracking-wider">⌘↵</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Email Preferences Modal */}
      {showEmailPrefs && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowEmailPrefs(false)}
        >
          <div
            className="bg-[#141414] rounded-2xl border border-[#252525] w-full max-w-[480px] flex flex-col overflow-hidden"
            style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-4 px-6 py-4 border-b border-[#252525]">
              <div className="p-2.5 rounded-xl bg-[#6364FF]/10">
                <svg className="w-5 h-5 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-[16px] font-semibold text-white">Email Preferences</h2>
                <p className="text-[11px] text-[#505050]">Configure AI behavior for outreach emails</p>
              </div>
              <button onClick={() => setShowEmailPrefs(false)} className="p-2 rounded-lg text-[#505050] hover:text-white hover:bg-[#252525] transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-5">
              {/* Style Instructions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-white">Style Instructions</label>
                  <span className="text-[10px] text-[#505050]">Applied to all AI emails</span>
                </div>
                <textarea
                  value={profile.emailInstructions || ''}
                  onChange={(e) => setProfile({ ...profile, emailInstructions: e.target.value || null })}
                  rows={4}
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg text-[13px] text-white p-4 focus:outline-none focus:border-[#6364FF] transition-colors resize-none leading-relaxed placeholder:text-[#404040]"
                  placeholder="e.g. Keep emails under 3 sentences. Always mention I'm looking for a summer internship."
                />
              </div>

              {/* Auto-Personalize Toggle */}
              <div className="flex items-center justify-between p-4 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg transition-colors ${profile.autoPersonalize ? 'bg-[#6364FF]/10' : 'bg-[#252525]'}`}>
                    <svg className={`w-4 h-4 transition-colors ${profile.autoPersonalize ? 'text-[#6364FF]' : 'text-[#505050]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-white block">Auto-Personalize</span>
                    <p className="text-[11px] text-[#505050]">Auto-personalize when opening review</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={profile.autoPersonalize}
                  onClick={() => setProfile({ ...profile, autoPersonalize: !profile.autoPersonalize })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                    profile.autoPersonalize ? 'bg-[#6364FF]' : 'bg-[#303030]'
                  }`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${profile.autoPersonalize ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#252525]">
              <button
                onClick={() => setShowEmailPrefs(false)}
                className="px-4 py-2 rounded-lg text-[12px] font-medium text-[#606060] hover:text-white hover:bg-[#252525] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowEmailPrefs(false)}
                className="bg-[#6364FF] text-white text-[12px] font-semibold px-5 py-2 rounded-lg hover:bg-[#5354EE] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded Attachment Modal */}
      {expandedResume && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setExpandedResume(null)}
        >
          <div
            className="bg-[#1a1a1a] rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#252525]">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-[#6364FF]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-white">{expandedResume.filename}</h3>
                  <p className="text-xs text-white">{formatFileSize(expandedResume.fileSize)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/resume/view?id=${expandedResume.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-white hover:text-white hover:bg-[#252525] rounded-lg transition-colors"
                  title="Open in new tab"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
                <button
                  onClick={() => setExpandedResume(null)}
                  className="p-2 text-white hover:text-white hover:bg-[#252525] rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Document viewer */}
            <div className="flex-1 bg-[#404040] min-h-[70vh]">
              {expandedResume.mimeType === 'application/pdf' ? (
                <iframe
                  src={`/api/resume/view?id=${expandedResume.id}`}
                  className="w-full h-full min-h-[70vh]"
                  title={expandedResume.filename}
                />
              ) : (
                <div className="w-full h-full min-h-[70vh] flex flex-col items-center justify-center text-white">
                  <svg className="w-16 h-16 text-[#6364FF] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-lg font-medium mb-2">{expandedResume.filename}</p>
                  <p className="text-sm text-white mb-4">Preview not available for this file type</p>
                  <a
                    href={`/api/resume/view?id=${expandedResume.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-[#6364FF] text-white rounded-lg hover:bg-[#5354EE] transition-colors text-sm font-medium"
                  >
                    Download File
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
