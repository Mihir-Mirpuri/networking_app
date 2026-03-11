'use client';

import { useState, useEffect, useRef } from 'react';
import { sendComposedEmailAction, FileAttachmentInput } from '@/app/actions/compose';
import { getProfileAction, getTemplatesAction, TemplateData, UserProfile } from '@/app/actions/profile';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { Toast } from '@/components/ui/Toast';

// Gmail-style toolbar icons
function IconAttach({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.58 12.58l-9-9a6.53 6.53 0 00-9.19 9.19l1.2 1.2a3.06 3.06 0 004.24 0l6.36-6.36a1.53 1.53 0 00-2.12-2.12L6.7 11.86a.75.75 0 001.06 1.06l6.36-6.36a3.06 3.06 0 014.24 4.24l-6.36 6.36a4.59 4.59 0 01-6.36-6.36l.71-.71-1.06-1.06-.71.71a6.12 6.12 0 008.49 8.49l6.36-6.36a4.53 4.53 0 000-6.36z" />
    </svg>
  );
}

function IconLink({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
    </svg>
  );
}

function IconEmoji({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
    </svg>
  );
}

function IconDelete({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13z" />
    </svg>
  );
}

function IconResume({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

function IconVideo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

function IconTemplate({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 12h2v5H7zm4-3h2v8h-2zm4-3h2v11h-2z" />
    </svg>
  );
}

function IconDropdown({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 5;

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (messageId: string, threadId: string) => void;
  variant?: 'modal' | 'embedded';
}

interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
}

export function ComposeEmailModal({
  isOpen,
  onClose,
  onSuccess,
  variant = 'modal',
}: ComposeEmailModalProps) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [videoLink, setVideoLink] = useState('');
  const [attachResume, setAttachResume] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);

  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);

  // Load templates and resumes on mount
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const applyProfileToTemplate = (text: string, profile: UserProfile | null): string => {
    if (!profile) return text;
    return text
      .replaceAll('{user_name}', profile.name || '')
      .replaceAll('{university}', profile.university || '')
      .replaceAll('{classification}', profile.classification || '')
      .replaceAll('{major}', profile.major || '')
      .replaceAll('{career}', profile.career || '')
      .replaceAll('{industry}', profile.career || '');
  };

  const loadData = async () => {
    setIsLoadingData(true);
    try {
      const [templatesResult, resumesResult, profileResult] = await Promise.all([
        getTemplatesAction(),
        getResumesAction(),
        getProfileAction(),
      ]);

      const profile = profileResult.success ? profileResult.profile : null;
      setUserProfile(profile);

      const hardcodedDefault = EMAIL_TEMPLATES[0];

      if (templatesResult.success) {
        const combinedTemplates: TemplateData[] = [
          ...templatesResult.templates,
          {
            id: hardcodedDefault.id,
            name: hardcodedDefault.name,
            subject: hardcodedDefault.subject,
            body: hardcodedDefault.body,
            isDefault: false,
            attachResume: false,
            resumeId: null,
            createdAt: new Date(),
          },
        ];
        setTemplates(combinedTemplates);

        if (!selectedTemplateId) {
          let initialTemplate: TemplateData | undefined;
          if (templatesResult.templates.length > 0) {
            const defaultTemplate = templatesResult.templates.find((t) => t.isDefault);
            initialTemplate = defaultTemplate || templatesResult.templates[0];
          } else {
            initialTemplate = combinedTemplates.find((t) => t.id === hardcodedDefault.id);
          }
          if (initialTemplate) {
            setSelectedTemplateId(initialTemplate.id);
            setSubject(applyProfileToTemplate(initialTemplate.subject, profile));
            setBody(applyProfileToTemplate(initialTemplate.body, profile));
            setAttachResume(initialTemplate.attachResume);
            if (initialTemplate.resumeId) {
              setSelectedResumeId(initialTemplate.resumeId);
            }
          }
        }
      }

      if (resumesResult.success) {
        setResumes(resumesResult.resumes);
        // Auto-select active resume
        const activeResume = resumesResult.resumes.find((r) => r.isActive);
        if (activeResume) {
          setSelectedResumeId(activeResume.id);
        }
      }
    } catch (err) {
      console.error('Error loading data:', err);
      const hardcodedDefault = EMAIL_TEMPLATES[0];
      setTemplates([
        {
          id: hardcodedDefault.id,
          name: hardcodedDefault.name,
          subject: hardcodedDefault.subject,
          body: hardcodedDefault.body,
          isDefault: false,
          attachResume: false,
          resumeId: null,
          createdAt: new Date(),
        },
      ]);
      if (!selectedTemplateId) {
        setSelectedTemplateId(hardcodedDefault.id);
      }
    } finally {
      setIsLoadingData(false);
    }
  };

  // Handle template selection
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);

    if (templateId) {
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        setSubject(applyProfileToTemplate(template.subject, userProfile));
        setBody(applyProfileToTemplate(template.body, userProfile));
        setAttachResume(template.attachResume);
        if (template.resumeId) {
          setSelectedResumeId(template.resumeId);
        }
      }
    }
  };

  useEffect(() => {
    if (!selectedTemplateId || templates.length === 0) return;
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) return;
    setSubject(applyProfileToTemplate(template.subject, userProfile));
    setBody(applyProfileToTemplate(template.body, userProfile));
    setAttachResume(template.attachResume);
    if (template.resumeId) {
      setSelectedResumeId(template.resumeId);
    }
  }, [selectedTemplateId, templates, userProfile]);

  // Validate email format
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleEmailBlur = () => {
    if (recipientEmail && !validateEmail(recipientEmail)) {
      setEmailError('Please enter a valid email address');
    } else {
      setEmailError(null);
    }
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: FileAttachment[] = [];
    const errors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Check total count
      if (fileAttachments.length + newAttachments.length >= MAX_ATTACHMENTS) {
        errors.push(`Maximum ${MAX_ATTACHMENTS} attachments allowed`);
        break;
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`"${file.name}" exceeds 10MB limit`);
        continue;
      }

      // Check for duplicates
      if (fileAttachments.some((a) => a.name === file.name)) {
        errors.push(`"${file.name}" is already attached`);
        continue;
      }

      newAttachments.push({
        id: `${Date.now()}-${i}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
      });
    }

    if (errors.length > 0) {
      setError(errors.join('. '));
    }

    if (newAttachments.length > 0) {
      setFileAttachments((prev) => [...prev, ...newAttachments]);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove file attachment
  const handleRemoveFile = (id: string) => {
    setFileAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Convert file to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleSend = async () => {
    setError(null);

    // Validate
    if (!recipientEmail) {
      setError('Recipient email is required');
      return;
    }

    if (!validateEmail(recipientEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    if (!body.trim()) {
      setError('Email body is required');
      return;
    }

    setIsSending(true);

    try {
      // Convert file attachments to base64
      const attachments: FileAttachmentInput[] = [];
      for (const attachment of fileAttachments) {
        const content = await fileToBase64(attachment.file);
        attachments.push({
          filename: attachment.name,
          content,
          mimeType: attachment.type,
          size: attachment.size,
        });
      }

      // Append video link to body if provided
      let finalBody = body;
      if (videoLink.trim()) {
        finalBody = `${body}\n\n---\nI recorded a quick video introduction for you:\n${videoLink.trim()}`;
      }

      const result = await sendComposedEmailAction({
        recipientEmail,
        recipientName: recipientName.trim() || undefined,
        subject,
        body: finalBody,
        attachResume,
        resumeId: attachResume ? selectedResumeId : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (result.success) {
        dispatchCreditsChanged();
        onSuccess?.(result.messageId, result.threadId);
        if (isEmbedded) {
          setShowSuccess(true);
          setTimeout(() => {
            setShowSuccess(false);
            handleClose();
          }, 2000);
        } else {
          handleClose();
        }
      } else if (result.error === 'LIMIT_REACHED') {
        setShowLimitModal(true);
        setLimitReached(true);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    // Reset form
    setRecipientEmail('');
    setRecipientName('');
    setShowSuccess(false);
    setSubject('');
    setBody('');
    setVideoLink('');
    setAttachResume(false);
    setSelectedTemplateId('');
    setFileAttachments([]);
    setError(null);
    setEmailError(null);
    onClose();
  };

  // ESC to close (modal variant only)
  useEffect(() => {
    if (!isOpen || variant === 'embedded') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, variant]);

  // Close template dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    if (showTemplateDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTemplateDropdown]);

  if (!isOpen) return null;

  const isEmbedded = variant === 'embedded';

  return (
    <div
      className={
        isEmbedded
          ? 'bg-white rounded-lg shadow-lg max-w-3xl w-full overflow-hidden flex flex-col'
          : 'fixed inset-0 lg:left-80 flex items-end justify-end z-50 p-4 sm:p-6 animate-fade-in'
      }
      onClick={!isEmbedded ? (e) => { if (e.target === e.currentTarget) handleClose(); } : undefined}
    >
      <div
        className={
          isEmbedded
            ? 'flex flex-col'
            : 'bg-white rounded-t-lg shadow-2xl w-full max-w-[580px] max-h-[85vh] overflow-hidden flex flex-col animate-scale-in'
        }
        style={!isEmbedded ? { boxShadow: '0 8px 40px rgba(0,0,0,0.35)' } : undefined}
      >
        {/* Gmail-style header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#404040] rounded-t-lg">
          <h2 className="text-sm font-medium text-white">New Message</h2>
          <div className="flex items-center gap-1">
            {!isEmbedded && (
              <button
                onClick={handleClose}
                className="p-1 hover:bg-[#555] rounded text-[#ccc] hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {showSuccess ? (
          <div className="flex flex-col items-center justify-center h-48 bg-white animate-fade-in">
            <svg className="w-12 h-12 text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-lg font-medium text-green-600">Email sent!</p>
          </div>
        ) : isLoadingData ? (
          <div className="flex items-center justify-center h-48 bg-white">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            {/* Gmail-style fields */}
            <div className="flex-1 overflow-y-auto bg-white">
              {/* To field */}
              <div className="flex items-center border-b border-[#e0e0e0] px-4">
                <span className="text-sm text-[#666] w-10 flex-shrink-0">To</span>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => {
                    setRecipientEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={handleEmailBlur}
                  placeholder=""
                  className={`flex-1 py-2.5 text-sm text-[#202124] bg-transparent outline-none ${emailError ? 'text-red-600' : ''}`}
                />
              </div>
              {emailError && (
                <div className="px-4 py-1 text-xs text-red-600 bg-red-50 border-b border-red-200">{emailError}</div>
              )}

              {/* Recipient Name field */}
              <div className="flex items-center border-b border-[#e0e0e0] px-4">
                <span className="text-sm text-[#666] w-10 flex-shrink-0">Name</span>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder=""
                  className="flex-1 py-2.5 text-sm text-[#202124] bg-transparent outline-none"
                />
              </div>

              {/* Subject field */}
              <div className="flex items-center border-b border-[#e0e0e0] px-4">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject"
                  className="flex-1 py-2.5 text-sm text-[#202124] bg-transparent outline-none placeholder-[#666]"
                />
              </div>

              {/* Body */}
              <div className="px-4 pt-3">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  placeholder=""
                  className="w-full text-sm text-[#202124] bg-transparent outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Video link input (toggle) */}
              {showVideoInput && (
                <div className="flex items-center border-t border-[#e0e0e0] px-4 mx-4 mt-1">
                  <IconVideo className="w-4 h-4 text-[#666] mr-2 flex-shrink-0" />
                  <input
                    type="url"
                    value={videoLink}
                    onChange={(e) => setVideoLink(e.target.value)}
                    placeholder="Paste Loom or video link..."
                    className="flex-1 py-2 text-sm text-[#202124] bg-transparent outline-none placeholder-[#999]"
                  />
                  <button
                    onClick={() => { setShowVideoInput(false); setVideoLink(''); }}
                    className="p-1 text-[#999] hover:text-[#333] transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              )}

            </div>

            {/* Persistent attachment banner - always visible above toolbar */}
            {(fileAttachments.length > 0 || (attachResume && selectedResumeId)) && (
              <div className="px-3 py-2 bg-[#eaf1fb] border-t border-[#d3e3fd] flex flex-wrap items-center gap-2">
                {attachResume && selectedResumeId && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#c2d7f0] rounded-full">
                    <IconResume className="w-3.5 h-3.5 text-[#1a73e8] flex-shrink-0" />
                    <span className="text-xs font-medium text-[#1a73e8] truncate max-w-[180px]">
                      {resumes.find(r => r.id === selectedResumeId)?.filename || 'Resume'}
                    </span>
                    <button
                      onClick={() => setAttachResume(false)}
                      className="p-0.5 text-[#7baaf7] hover:text-[#1a73e8] transition-colors"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>
                )}
                {fileAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-[#dadce0] rounded-full"
                  >
                    <IconAttach className="w-3.5 h-3.5 text-[#5f6368] flex-shrink-0" />
                    <span className="text-xs text-[#202124] truncate max-w-[140px]">
                      {attachment.name}
                    </span>
                    <span className="text-[10px] text-[#999] flex-shrink-0">
                      {formatFileSize(attachment.size)}
                    </span>
                    <button
                      onClick={() => handleRemoveFile(attachment.id)}
                      className="p-0.5 text-[#999] hover:text-[#333] transition-colors"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="px-4 py-2 bg-red-50 text-red-600 text-sm border-t border-red-200">
                {error}
              </div>
            )}

            {/* Gmail-style bottom toolbar */}
            <div className="flex items-center gap-0.5 px-3 py-2 bg-[#f8f9fa] border-t border-[#e0e0e0]">
              {/* Send button with dropdown */}
              <button
                onClick={limitReached ? () => setShowLimitModal(true) : handleSend}
                disabled={limitReached ? false : (isSending || isLoadingData)}
                className="flex items-center gap-0 rounded-l-full bg-[#0b57d0] hover:bg-[#0842a0] text-white text-sm font-medium pl-5 pr-3 py-2 transition-colors disabled:opacity-50"
              >
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <LoadingSpinner size="sm" />
                    Sending...
                  </span>
                ) : limitReached ? (
                  'Limit reached'
                ) : (
                  <span className="flex items-center gap-1.5">
                    Send
                    {(fileAttachments.length > 0 || (attachResume && selectedResumeId)) && (
                      <span className="flex items-center gap-1 ml-0.5 px-1.5 py-0.5 bg-white/20 rounded-full text-[11px]">
                        <IconAttach className="w-3 h-3" />
                        {fileAttachments.length + (attachResume && selectedResumeId ? 1 : 0)}
                      </span>
                    )}
                  </span>
                )}
              </button>
              <button className="rounded-r-full bg-[#0b57d0] hover:bg-[#0842a0] text-white px-2 py-2 border-l border-[#1a68d4] transition-colors">
                <IconDropdown className="w-4 h-4" />
              </button>

              <div className="w-px h-5 bg-[#dadce0] mx-2" />

              {/* Toolbar icons */}
              <div className="flex items-center gap-0.5">
                {/* Attach file */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-attachment-input"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-full text-[#444746] hover:bg-[#e8eaed] transition-colors"
                  title="Attach files"
                  disabled={fileAttachments.length >= MAX_ATTACHMENTS}
                >
                  <IconAttach className="w-5 h-5" />
                </button>

                {/* Link */}
                <button
                  onClick={() => setShowVideoInput(!showVideoInput)}
                  className={`p-2 rounded-full transition-colors ${showVideoInput ? 'bg-[#e8eaed] text-[#0b57d0]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
                  title="Insert video link"
                >
                  <IconLink className="w-5 h-5" />
                </button>

                {/* Emoji */}
                <button className="p-2 rounded-full text-[#444746] hover:bg-[#e8eaed] transition-colors" title="Insert emoji">
                  <IconEmoji className="w-5 h-5" />
                </button>

                {/* Resume */}
                {resumes.length > 0 && (
                  <button
                    onClick={() => {
                      if (attachResume) {
                        setAttachResume(false);
                      } else {
                        setAttachResume(true);
                        if (!selectedResumeId) {
                          const activeResume = resumes.find(r => r.isActive);
                          if (activeResume) setSelectedResumeId(activeResume.id);
                          else if (resumes[0]) setSelectedResumeId(resumes[0].id);
                        }
                      }
                    }}
                    className={`p-2 rounded-full transition-colors ${attachResume ? 'bg-[#e8eaed] text-[#0b57d0]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
                    title={attachResume ? 'Remove resume' : 'Attach resume'}
                  >
                    <IconResume className="w-5 h-5" />
                  </button>
                )}

                {/* Template selector */}
                <div className="relative" ref={templateDropdownRef}>
                  <button
                    onClick={() => setShowTemplateDropdown(!showTemplateDropdown)}
                    className={`p-2 rounded-full transition-colors ${showTemplateDropdown ? 'bg-[#e8eaed] text-[#0b57d0]' : 'text-[#444746] hover:bg-[#e8eaed]'}`}
                    title="Choose template"
                  >
                    <IconTemplate className="w-5 h-5" />
                  </button>
                  {showTemplateDropdown && (
                    <div className="absolute bottom-full left-0 mb-2 w-56 bg-white rounded-lg shadow-lg border border-[#e0e0e0] py-1 z-10">
                      {templates.map((template) => (
                        <button
                          key={template.id}
                          onClick={() => {
                            handleTemplateChange(template.id);
                            setShowTemplateDropdown(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-[#f1f3f4] transition-colors ${
                            selectedTemplateId === template.id ? 'text-[#0b57d0] font-medium bg-[#e8f0fe]' : 'text-[#202124]'
                          }`}
                        >
                          {template.name} {template.isDefault ? '(Default)' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Delete/discard */}
              <button
                onClick={handleClose}
                className="p-2 rounded-full text-[#444746] hover:bg-[#e8eaed] transition-colors"
                title="Discard"
              >
                <IconDelete className="w-5 h-5" />
              </button>
            </div>
          </>
        )}
      </div>

      <LimitReachedModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        onCreditsAwarded={(credits) => {
          setLimitReached(false);
          setToast({ message: `+${credits} email credits added!`, type: 'success' });
          dispatchCreditsChanged();
        }}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
