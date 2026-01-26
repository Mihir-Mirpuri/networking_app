'use client';

import { useState, useEffect, useRef } from 'react';
import { sendComposedEmailAction, FileAttachmentInput } from '@/app/actions/compose';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';
import { getResumesAction, ResumeData } from '@/app/actions/resume';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 5;

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (messageId: string, threadId: string) => void;
}

interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
}

export function ComposeEmailModal({ isOpen, onClose, onSuccess }: ComposeEmailModalProps) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachResume, setAttachResume] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);

  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load templates and resumes on mount
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setIsLoadingData(true);
    try {
      const [templatesResult, resumesResult] = await Promise.all([
        getTemplatesAction(),
        getResumesAction(),
      ]);

      if (templatesResult.success) {
        setTemplates(templatesResult.templates);
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
        setSubject(template.subject);
        setBody(template.body);
        setAttachResume(template.attachResume);
        if (template.resumeId) {
          setSelectedResumeId(template.resumeId);
        }
      }
    }
  };

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
        recipientName: recipientName || undefined,
        subject,
        body,
        attachResume,
        resumeId: attachResume ? selectedResumeId : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (result.success) {
        onSuccess?.(result.messageId, result.threadId);
        handleClose();
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
    setSubject('');
    setBody('');
    setAttachResume(false);
    setSelectedTemplateId('');
    setFileAttachments([]);
    setError(null);
    setEmailError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Compose Email</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-full"
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
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoadingData ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <>
              {/* Template Selector */}
              {templates.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Template (optional)
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a template...</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} {template.isDefault ? '(Default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* To Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    emailError ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {emailError && (
                  <p className="mt-1 text-sm text-red-600">{emailError}</p>
                )}
              </div>

              {/* Recipient Name (optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Recipient Name (optional)
                </label>
                <input
                  type="text"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  placeholder="Write your message here..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="attachResume" className="text-sm font-medium text-gray-700">
                      Attach Resume
                    </label>
                  </div>

                  {attachResume && (
                    <select
                      value={selectedResumeId}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-gray-700">
                  Attachments
                </label>

                {/* File list */}
                {fileAttachments.length > 0 && (
                  <div className="space-y-2">
                    {fileAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between px-3 py-2 bg-gray-50 border border-gray-200 rounded-md"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <svg
                            className="w-4 h-4 text-gray-500 flex-shrink-0"
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
                          <span className="text-sm text-gray-700 truncate">
                            {attachment.name}
                          </span>
                          <span className="text-xs text-gray-500 flex-shrink-0">
                            ({formatFileSize(attachment.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(attachment.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
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
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    <p className="text-xs text-gray-500">
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
        <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
          <button
            onClick={handleClose}
            disabled={isSending}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || isLoadingData}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Sending...
              </span>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
