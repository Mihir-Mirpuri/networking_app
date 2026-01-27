'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { sendComposedEmailAction, FileAttachmentInput } from '@/app/actions/compose';
import { personalizeEmailAction, applyFoundInfoAction } from '@/app/actions/personalize';
import { getTemplatesAction, TemplateData } from '@/app/actions/profile';
import { getResumesAction, ResumeData } from '@/app/actions/resume';
import { EMAIL_TEMPLATES } from '@/lib/constants';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 5;
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || '';

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
  const [recipientCompany, setRecipientCompany] = useState('');
  const [recipientRole, setRecipientRole] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
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

  // Personalization state
  const [isPersonalizing, setIsPersonalizing] = useState(false);
  const [personalizeError, setPersonalizeError] = useState<string | null>(null);
  const [showPersonalizeModal, setShowPersonalizeModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [personalizeResult, setPersonalizeResult] = useState<{
    similarityFound: boolean;
    changes?: string[];
    foundInfo?: string[];
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if Chrome extension is installed
  const checkExtension = useCallback(async (): Promise<boolean> => {
    if (!EXTENSION_ID) {
      console.warn('Extension ID not configured');
      return false;
    }

    return new Promise((resolve) => {
      try {
        // @ts-expect-error - Chrome extension API
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          // @ts-expect-error - Chrome extension API
          chrome.runtime.sendMessage(
            EXTENSION_ID,
            { action: 'ping' },
            (response: { success: boolean } | undefined) => {
              // @ts-expect-error - Chrome extension API
              if (chrome.runtime.lastError) {
                resolve(false);
              } else {
                resolve(response?.success === true);
              }
            }
          );
          // Timeout if no response
          setTimeout(() => resolve(false), 1000);
        } else {
          resolve(false);
        }
      } catch {
        resolve(false);
      }
    });
  }, []);

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
          if (templatesResult.templates.length > 0) {
            const defaultTemplate = templatesResult.templates.find((t) => t.isDefault);
            setSelectedTemplateId(defaultTemplate ? defaultTemplate.id : templatesResult.templates[0].id);
          } else {
            setSelectedTemplateId(hardcodedDefault.id);
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
        setSubject(template.subject);
        setBody(template.body);
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
    setSubject(template.subject);
    setBody(template.body);
    setAttachResume(template.attachResume);
    if (template.resumeId) {
      setSelectedResumeId(template.resumeId);
    }
  }, [selectedTemplateId, templates]);

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
    setRecipientCompany('');
    setRecipientRole('');
    setLinkedinUrl('');
    setSubject('');
    setBody('');
    setAttachResume(false);
    setSelectedTemplateId('');
    setFileAttachments([]);
    setError(null);
    setEmailError(null);
    setPersonalizeError(null);
    setPersonalizeResult(null);
    setShowPersonalizeModal(false);
    onClose();
  };

  if (!isOpen) return null;

  const isEmbedded = variant === 'embedded';

  const getRecipientName = () => {
    const localPart = recipientEmail.split('@')[0] || '';
    if (!localPart) return 'there';
    return localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  const runPersonalization = async () => {
    if (!linkedinUrl) return;

    setIsPersonalizing(true);
    setPersonalizeError(null);

    try {
      const scrapeResult = await new Promise<{ success: boolean; data?: unknown; error?: string }>((resolve) => {
        // @ts-expect-error - Chrome extension API
        chrome.runtime.sendMessage(
          EXTENSION_ID,
          {
            action: 'scrapeLinkedIn',
            linkedinUrl,
          },
          (response: { success: boolean; data?: unknown; error?: string } | undefined) => {
            // @ts-expect-error - Chrome extension API
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: 'Extension communication failed' });
            } else if (response) {
              resolve(response);
            } else {
              resolve({ success: false, error: 'No response from extension' });
            }
          }
        );

        setTimeout(() => {
          resolve({ success: false, error: 'Request timed out' });
        }, 30000);
      });

      if (!scrapeResult.success) {
        throw new Error(scrapeResult.error || 'Failed to scrape LinkedIn profile');
      }

      const result = await personalizeEmailAction({
        linkedinData: scrapeResult.data as Parameters<typeof personalizeEmailAction>[0]['linkedinData'],
        originalSubject: subject,
        originalBody: body,
        personName: getRecipientName(),
        personCompany: recipientCompany || 'their company',
        personRole: recipientRole || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to personalize email');
      }

      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);

      setPersonalizeResult({
        similarityFound: result.similarityFound || false,
        changes: result.changes,
        foundInfo: result.foundInfo,
      });
    } catch (err) {
      console.error('Personalization error:', err);
      setPersonalizeError(err instanceof Error ? err.message : 'Personalization failed');
    } finally {
      setIsPersonalizing(false);
    }
  };

  const handlePersonalize = async () => {
    if (!linkedinUrl) {
      setPersonalizeError('Add a LinkedIn URL to personalize');
      return;
    }

    setPersonalizeError(null);
    const installed = await checkExtension();
    if (!installed) {
      setShowExtensionModal(true);
      return;
    }

    await runPersonalization();
  };

  const handleUseFoundInfo = async () => {
    if (!personalizeResult?.foundInfo) return;

    setIsPersonalizing(true);
    setPersonalizeError(null);

    try {
      const result = await applyFoundInfoAction({
        foundInfo: personalizeResult.foundInfo,
        originalSubject: subject,
        originalBody: body,
        personName: getRecipientName(),
        personCompany: recipientCompany || 'their company',
        personRole: recipientRole || undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to personalize email');
      }

      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);

      setPersonalizeResult({
        similarityFound: true,
        changes: result.changes,
        foundInfo: undefined,
      });
    } catch (err) {
      console.error('UseFoundInfo error:', err);
      setPersonalizeError(err instanceof Error ? err.message : 'Failed to personalize');
    } finally {
      setIsPersonalizing(false);
    }
  };

  return (
    <div
      className={
        isEmbedded
          ? 'bg-white rounded-lg shadow max-w-3xl w-full overflow-hidden flex flex-col'
          : 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'
      }
    >
      <div
        className={
          isEmbedded
            ? 'flex flex-col'
            : 'bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col'
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Compose Email</h2>
          {!isEmbedded && (
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
          )}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template (optional)
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  disabled={isLoadingData}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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

              {/* Personalize Button */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setPersonalizeError(null);
                    setShowPersonalizeModal(true);
                  }}
                  disabled={isPersonalizing}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPersonalizing ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Personalizing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      Personalize with AI
                    </>
                  )}
                </button>
                {personalizeError && (
                  <p className="mt-2 text-sm text-red-600">{personalizeError}</p>
                )}

                {personalizeResult && (
                  <div className="mt-3">
                    {personalizeResult.similarityFound ? (
                      <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                        <p className="text-sm font-medium text-green-800">Changes made:</p>
                        <ul className="mt-1 text-sm text-green-700 list-disc list-inside">
                          {personalizeResult.changes?.map((change, i) => (
                            <li key={i}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                        <p className="text-sm font-medium text-amber-800">No similarities found.</p>
                        {personalizeResult.foundInfo && personalizeResult.foundInfo.length > 0 && (
                          <>
                            <p className="mt-2 text-sm text-amber-700">Found this about them:</p>
                            <ul className="mt-1 text-sm text-amber-700 list-disc list-inside">
                              {personalizeResult.foundInfo.map((info, i) => (
                                <li key={i}>{info}</li>
                              ))}
                            </ul>
                            <button
                              type="button"
                              onClick={handleUseFoundInfo}
                              disabled={isPersonalizing}
                              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 disabled:opacity-50"
                            >
                              {isPersonalizing ? 'Applying...' : 'Use this info'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
          {!isEmbedded && (
            <button
              onClick={handleClose}
              disabled={isSending}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
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

      {/* Extension Install Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Install LinkedIn Helper</h3>
                <p className="text-sm text-gray-500">One-time setup (10 seconds)</p>
              </div>
            </div>

            <p className="text-gray-600 mb-6">
              To personalize emails, install our Chrome extension. It reads LinkedIn profiles to help craft better outreach messages.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Note:</strong> You need to be logged into LinkedIn for this to work. The extension only reads public profile data.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
              <a
                href="https://chrome.google.com/webstore/detail/lattice-linkedin-helper/YOUR_EXTENSION_ID"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-3.952 6.848a12.014 12.014 0 0 0 9.193-5.101A11.94 11.94 0 0 0 24 12c0-1.537-.29-3.009-.818-4.364zM12 8.91a3.091 3.091 0 1 0 0 6.181 3.091 3.091 0 0 0 0-6.181z"/>
                </svg>
                Add to Chrome
              </a>
            </div>

            <p className="mt-4 text-xs text-gray-500 text-center">
              After installing, click &quot;Personalize with AI&quot; again
            </p>
          </div>
        </div>
      )}

      {showPersonalizeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold mb-1">Personalize with AI</h3>
            <p className="text-sm text-gray-500 mb-4">
              Add a LinkedIn URL to personalize. Company and role are optional.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  LinkedIn URL
                </label>
                <input
                  type="url"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/in/..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Company (optional)
                  </label>
                  <input
                    type="text"
                    value={recipientCompany}
                    onChange={(e) => setRecipientCompany(e.target.value)}
                    placeholder="Company"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role (optional)
                  </label>
                  <input
                    type="text"
                    value={recipientRole}
                    onChange={(e) => setRecipientRole(e.target.value)}
                    placeholder="Role"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {personalizeError && (
              <p className="mt-3 text-sm text-red-600">{personalizeError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPersonalizeModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handlePersonalize();
                  if (linkedinUrl) {
                    setShowPersonalizeModal(false);
                  }
                }}
                disabled={isPersonalizing}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPersonalizing ? 'Personalizing...' : 'Personalize'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
