'use client';

import { useState, useEffect, useRef } from 'react';
import { sendComposedEmailAction, FileAttachmentInput } from '@/app/actions/compose';
import { getProfileAction, getTemplatesAction, TemplateData, UserProfile } from '@/app/actions/profile';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
import { EMAIL_TEMPLATES } from '@/lib/constants';
import { LoadingSpinner } from '@/components/search/LoadingSpinner';
import { CompanyResearchPanel } from '@/components/compose/CompanyResearchPanel';
import { LimitReachedModal, dispatchCreditsChanged } from '@/components/credits';
import { Toast } from '@/components/ui/Toast';

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
  const [recipientCompany, setRecipientCompany] = useState('');
  const [recipientRole, setRecipientRole] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
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

      const result = await sendComposedEmailAction({
        recipientEmail,
        recipientName: recipientName.trim() || undefined,
        subject,
        body,
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
    setRecipientCompany('');
    setRecipientRole('');
    setShowSuccess(false);
    setSubject('');
    setBody('');
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

  if (!isOpen) return null;

  const isEmbedded = variant === 'embedded';

  const handleUseTalkingPoint = (point: string) => {
    const lines = body.split('\n');
    const insertIdx = lines.findIndex(l => l.trim() === '') + 1 || 1;
    lines.splice(insertIdx, 0, `\nI saw that ${point.charAt(0).toLowerCase() + point.slice(1)} — really cool.\n`);
    setBody(lines.join('\n'));
  };

  return (
    <div
      className={
        isEmbedded
          ? 'bg-white rounded-lg shadow max-w-3xl w-full overflow-hidden flex flex-col'
          : 'fixed inset-0 bg-surface-900/50 flex items-center justify-center z-50 p-4 animate-fade-in'
      }
      onClick={!isEmbedded ? (e) => { if (e.target === e.currentTarget) handleClose(); } : undefined}
    >
      <div
        className={
          isEmbedded
            ? 'flex flex-col'
            : 'bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-scale-in'
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Compose Email</h2>
          {!isEmbedded && (
            <button
              onClick={handleClose}
              className="p-2 hover:bg-surface-100 rounded-full"
              aria-label="Close"
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
          )}
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {showSuccess ? (
            <div className="flex flex-col items-center justify-center h-32 animate-fade-in">
              <svg className="w-12 h-12 text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium text-green-700">Email sent!</p>
            </div>
          ) : isLoadingData ? (
            <div className="flex items-center justify-center h-32">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <>
              {/* Template Selector */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Template (optional)
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  disabled={isLoadingData}
                  className="input"
                >
                  {isLoadingData ? (
                    <option value="">Loading templates...</option>
                  ) : (
                    templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} {template.isDefault ? '(Default)' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* To Field */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  To <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => {
                    setRecipientEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  onBlur={handleEmailBlur}
                  placeholder="recipient@example.com"
                  className={`input ${emailError ? 'border-red-500' : ''}`}
                />
                {emailError && (
                  <p className="mt-1 text-sm text-red-600">{emailError}</p>
                )}
              </div>

              {/* Recipient Name */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Jane Smith"
                  className="input"
                />
              </div>

              {/* Company */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={recipientCompany}
                  onChange={(e) => setRecipientCompany(e.target.value)}
                  placeholder="Acme Inc."
                  className="input"
                />
              </div>

              {/* Company Research */}
              {recipientCompany && (
                <CompanyResearchPanel
                  company={recipientCompany}
                  role={recipientRole}
                  body={body}
                  onUseTalkingPoint={handleUseTalkingPoint}
                />
              )}

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="input"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  placeholder="Write your message here..."
                  className="input resize-none"
                />
              </div>

              {/* Resume Attachment */}
              {resumes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="attachResume"
                      checked={attachResume}
                      onChange={(e) => setAttachResume(e.target.checked)}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-surface-300 rounded"
                    />
                    <label htmlFor="attachResume" className="text-sm font-medium text-surface-700">
                      Attach Resume
                    </label>
                  </div>

                  {attachResume && (
                    <select
                      value={selectedResumeId}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      className="input"
                    >
                      <option value="">Select a resume...</option>
                      {resumes.map((resume) => (
                        <option key={resume.id} value={resume.id}>
                          {resume.filename} {resume.isActive ? '(Active)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* File Attachments */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-surface-700">
                  Attachments
                </label>

                {/* File list */}
                {fileAttachments.length > 0 && (
                  <div className="space-y-2">
                    {fileAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between px-3 py-2 bg-surface-50 border border-surface-200 rounded-md"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <svg
                            className="w-4 h-4 text-surface-500 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                            />
                          </svg>
                          <span className="text-sm text-surface-700 truncate">
                            {attachment.name}
                          </span>
                          <span className="text-xs text-surface-500 flex-shrink-0">
                            ({formatFileSize(attachment.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(attachment.id)}
                          className="p-1 text-surface-400 hover:text-red-500"
                          aria-label={`Remove ${attachment.name}`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add file button */}
                {fileAttachments.length < MAX_ATTACHMENTS && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-attachment-input"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-secondary text-sm gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      Add File
                    </button>
                    <p className="text-xs text-surface-500">
                      Max {MAX_ATTACHMENTS} files, 10MB each
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-100 text-red-800 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-surface-50">
          {!isEmbedded && (
            <button
              onClick={handleClose}
              disabled={isSending}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          )}
          <button
            onClick={limitReached ? () => setShowLimitModal(true) : handleSend}
            disabled={limitReached ? false : (isSending || isLoadingData)}
            className={`btn-primary text-sm${limitReached ? ' opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSending ? (
              <span className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                Sending...
              </span>
            ) : limitReached ? (
              'Daily limit reached'
            ) : (
              'Send'
            )}
          </button>
        </div>
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
