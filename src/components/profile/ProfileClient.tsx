'use client';

import { useState, useEffect } from 'react';
import { signOut, useSession } from 'next-auth/react';
import {
  getProfileAction,
  updateProfileAction,
  getTemplatesAction,
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
  setDefaultTemplateAction,
  UserProfile,
  TemplateData,
} from '@/app/actions/profile';
import {
  getResumesAction,
  setActiveResumeAction,
  deleteResumeAction,
  ResumeData,
} from '@/app/actions/resume';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { UNIVERSITIES, CLASSIFICATIONS } from '@/lib/constants';

interface ProfileClientProps {
  userEmail: string;
  userName: string;
  userImage: string;
}

const DEFAULT_TEMPLATE = {
  name: 'Default',
  subject: 'Reaching out from {university}',
  body: `Hi {first_name},

I hope you are doing well. My name is {user_name} and I am a {classification} pursuing my {major} at {university}. I am interested in {career} and would love to grab 10-15 minutes on the phone with you to hear about your experiences at {company}.

In case it's helpful to provide more context on my background, I have attached my resume below for your reference. I look forward to hearing from you.

Warm regards,
{user_name}`,
};

// Default placeholders that are always available
const DEFAULT_PLACEHOLDERS = [
  '{first_name}',
  '{user_name}',
  '{company}',
  '{university}',
  '{classification}',
  '{major}',
  '{career}',
  '{role}',
];

// Helper function to extract placeholders from template text
function extractPlaceholders(text: string): string[] {
  const regex = /\{([^}]+)\}/g;
  const matches = new Set<string>();
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.add(`{${match[1]}}`);
  }
  return Array.from(matches);
}

export function ProfileClient({ userEmail, userName, userImage }: ProfileClientProps) {
  const { status } = useSession();

  // Profile state
  const [profile, setProfile] = useState<UserProfile>({
    name: userName,
    classification: null,
    major: null,
    university: null,
    career: null,
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<TemplateData | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateData | null>(null);
  const [showDefaultTemplate, setShowDefaultTemplate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    subject: '',
    body: '',
    attachResume: false,
    resumeId: null as string | null
  });
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Resume state
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [isLoadingResumes, setIsLoadingResumes] = useState(true);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeSuccess, setResumeSuccess] = useState(false);

  // Load profile, templates, and resumes on mount - but only when session is ready
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
    }
    setIsLoadingProfile(false);
  };

  const loadTemplates = async () => {
    setIsLoadingTemplates(true);
    const result = await getTemplatesAction();
    if (result.success) {
      // If no templates exist, we'll show a placeholder for the default
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

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);

    const result = await updateProfileAction(profile);
    if (result.success) {
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } else {
      setProfileError(result.error);
    }
    setIsSavingProfile(false);
  };

  const handleCreateTemplate = async () => {
    if (!newTemplate.name.trim() || !newTemplate.body.trim()) {
      setTemplateError('Template name and body are required');
      return;
    }

    setIsSavingTemplate(true);
    setTemplateError(null);

    const result = await createTemplateAction({
      name: newTemplate.name,
      subject: newTemplate.subject,
      body: newTemplate.body,
      attachResume: newTemplate.attachResume,
      resumeId: newTemplate.resumeId,
    });
    if (result.success) {
      setTemplates([...templates, result.template]);
      setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null });
      setIsCreating(false);
    } else {
      setTemplateError(result.error);
    }
    setIsSavingTemplate(false);
  };

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

  const handleSetDefault = async (id: string) => {
    const result = await setDefaultTemplateAction(id);
    if (result.success) {
      setTemplates(
        templates.map((t) => ({
          ...t,
          isDefault: t.id === id,
        }))
      );
    } else {
      setTemplateError(result.error);
    }
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin' });
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload resume');
      }

      setResumeSuccess(true);
      setTimeout(() => setResumeSuccess(false), 3000);
      await loadResumes();
      
      // Reset file input
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
    
    if (days === 0) return 'Uploaded today';
    if (days === 1) return 'Uploaded yesterday';
    if (days < 7) return `Uploaded ${days} days ago`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `Uploaded ${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    return new Date(date).toLocaleDateString();
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-surface-900">Profile</h1>
      </div>

      {/* Profile Info Section */}
      <div className="card p-6">
        <div className="flex items-center gap-5 mb-8 pb-6 border-b border-surface-200">
          {userImage ? (
            <img
              src={userImage}
              alt={userName || 'Profile'}
              className="w-16 h-16 rounded-full ring-4 ring-surface-100 shadow-soft"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center ring-4 ring-surface-100 shadow-soft">
              <span className="text-2xl text-white font-semibold">
                {(userName || userEmail || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <p className="text-surface-600 mb-1.5">{userEmail}</p>
            <span className="badge-success">
              Google Connected
            </span>
          </div>
        </div>

        {profileSaved && (
          <div className="mb-6 px-4 py-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Profile saved successfully!
          </div>
        )}

        {profileError && (
          <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {profileError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              value={profile.name || ''}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              disabled={isLoadingProfile}
              className="input"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="classification" className="block text-sm font-medium text-surface-700 mb-1.5">
              Classification
            </label>
            <select
              id="classification"
              value={profile.classification || ''}
              onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
              disabled={isLoadingProfile}
              className="input"
            >
              <option value="">Select classification</option>
              {CLASSIFICATIONS.map((classification) => (
                <option key={classification} value={classification}>
                  {classification}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Major
            </label>
            <input
              type="text"
              value={profile.major || ''}
              onChange={(e) => setProfile({ ...profile, major: e.target.value })}
              disabled={isLoadingProfile}
              className="input"
              placeholder="e.g., Computer Science, Finance"
            />
          </div>

          <SearchableCombobox
            options={UNIVERSITIES}
            value={profile.university || ''}
            onChange={(value) => setProfile({ ...profile, university: value })}
            label="University"
            placeholder="Search universities..."
            id="university"
            disabled={isLoadingProfile}
          />

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-surface-700 mb-1.5">
              Career Interest
            </label>
            <input
              type="text"
              value={profile.career || ''}
              onChange={(e) => setProfile({ ...profile, career: e.target.value })}
              disabled={isLoadingProfile}
              className="input"
              placeholder="e.g., Investment Banking, Consulting"
            />
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-surface-200 flex gap-3">
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile || isLoadingProfile}
            className="btn-primary"
          >
            {isSavingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Resume Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-6">Resume</h2>

        {resumeSuccess && (
          <div className="mb-6 px-4 py-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Resume uploaded successfully!
          </div>
        )}

        {resumeError && (
          <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {resumeError}
          </div>
        )}

        {/* Upload Section */}
        <div className="mb-6 p-4 border-2 border-dashed border-surface-300 rounded-xl hover:border-primary-400 transition-colors">
          <label className="block text-sm font-medium text-surface-700 mb-2">
            Upload Resume
          </label>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleUploadResume}
            disabled={isUploadingResume}
            className="w-full text-sm text-surface-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 disabled:opacity-50 cursor-pointer"
          />
          <p className="mt-2 text-xs text-surface-500">
            Accepted formats: PDF, DOC, DOCX (Max 10MB)
          </p>
          {isUploadingResume && (
            <p className="mt-2 text-sm text-primary-600 flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading...
            </p>
          )}
        </div>

        {/* Resumes List */}
        {isLoadingResumes ? (
          <div className="text-center py-8 text-surface-500">Loading resumes...</div>
        ) : resumes.length === 0 ? (
          <div className="text-center py-12 text-surface-500">
            <svg className="w-12 h-12 mx-auto mb-3 text-surface-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-medium">No resumes uploaded yet</p>
            <p className="text-sm mt-1">Upload your first resume above</p>
          </div>
        ) : (
          <div className="space-y-3">
            {resumes.map((resume) => (
              <div
                key={resume.id}
                className="group flex items-center justify-between p-4 border border-surface-200 rounded-xl hover:border-surface-300 hover:shadow-soft transition-all"
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-11 h-11 bg-primary-50 rounded-xl flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-primary-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-surface-900 truncate">
                        {resume.filename}
                      </p>
                      {resume.isActive && (
                        <span className="badge-primary flex-shrink-0">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-surface-500">
                      <span>{formatFileSize(resume.fileSize)}</span>
                      <span className="text-surface-300">•</span>
                      <span>{formatDate(resume.uploadedAt)}</span>
                      <span className="text-surface-300">•</span>
                      <span>Version {resume.version}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!resume.isActive && (
                    <button
                      onClick={() => handleSetActiveResume(resume.id)}
                      className="px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      Set Active
                    </button>
                  )}
                  <a
                    href={`/api/resume/view?id=${resume.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm font-medium text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
                  >
                    View
                  </a>
                  <button
                    onClick={() => handleDeleteResume(resume.id)}
                    className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Templates Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-6">My Templates</h2>

        {templateError && (
          <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg border border-red-200 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {templateError}
          </div>
        )}

        {/* Templates List - Just Names */}
        {isLoadingTemplates ? (
          <div className="text-center py-8 text-surface-500">Loading templates...</div>
        ) : (
          <div className="space-y-2">
            {/* Default Template (shown when no templates exist or as first option) */}
            {templates.length === 0 && (
              <button
                onClick={() => setShowDefaultTemplate(true)}
                className="group w-full text-left px-4 py-4 border border-surface-200 rounded-xl hover:border-primary-300 hover:bg-primary-50/30 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-surface-900">Default Template</span>
                  <span className="badge-primary">
                    Default
                  </span>
                </div>
                <svg className="w-5 h-5 text-surface-400 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* User Templates */}
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplate(template)}
                className="group w-full text-left px-4 py-4 border border-surface-200 rounded-xl hover:border-primary-300 hover:bg-primary-50/30 transition-all flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-surface-900">{template.name}</span>
                  {template.isDefault && (
                    <span className="badge-primary">
                      Default
                    </span>
                  )}
                  {template.attachResume && (
                    <span className="badge-success">
                      Resume
                    </span>
                  )}
                </div>
                <svg className="w-5 h-5 text-surface-400 group-hover:text-primary-500 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {/* Add Template Button - Below all templates */}
            {!isCreating && (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full px-4 py-4 border-2 border-dashed border-surface-300 rounded-xl text-surface-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/30 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Template
              </button>
            )}
          </div>
        )}

        {/* Create New Template Form */}
        {isCreating && (
          <div className="mt-4 p-5 border border-primary-200 rounded-xl bg-primary-50/50">
            <h3 className="font-semibold text-surface-900 mb-4">New Template</h3>
            <div className="space-y-4">
              <input
                type="text"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                className="input"
                placeholder="Template name"
              />
              <input
                type="text"
                value={newTemplate.subject}
                onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                className="input"
                placeholder="Email subject (use {placeholder} syntax)"
              />
              <textarea
                value={newTemplate.body}
                onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                rows={6}
                className="input resize-none"
                placeholder="Email body (use {placeholder} syntax for dynamic content)"
              />
              {/* Detected Placeholders */}
              {(newTemplate.subject || newTemplate.body) && (
                <div className="p-4 bg-white rounded-lg border border-surface-200">
                  <p className="text-xs font-semibold text-surface-700 mb-2">Detected Placeholders:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {extractPlaceholders(newTemplate.subject + ' ' + newTemplate.body).length > 0 ? (
                      extractPlaceholders(newTemplate.subject + ' ' + newTemplate.body).map((placeholder) => (
                        <span
                          key={placeholder}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            DEFAULT_PLACEHOLDERS.includes(placeholder)
                              ? 'bg-primary-100 text-primary-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {placeholder}
                          {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                            <span className="ml-1 opacity-70">(custom)</span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-surface-500">No placeholders detected</span>
                    )}
                  </div>
                  <p className="text-xs text-surface-500 mt-3">
                    Default placeholders (auto-filled): {DEFAULT_PLACEHOLDERS.join(', ')}
                  </p>
                </div>
              )}
              {/* Resume Attachment Section */}
              <div className="space-y-3 pt-4 border-t border-surface-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newTemplate.attachResume}
                    onChange={(e) => setNewTemplate({ ...newTemplate, attachResume: e.target.checked, resumeId: e.target.checked ? newTemplate.resumeId : null })}
                    className="w-4 h-4 text-primary-600 border-surface-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm font-medium text-surface-700">
                    Attach resume to emails using this template
                  </span>
                </label>
                {newTemplate.attachResume && resumes.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">
                      Select Resume
                    </label>
                    <select
                      value={newTemplate.resumeId || ''}
                      onChange={(e) => setNewTemplate({ ...newTemplate, resumeId: e.target.value || null })}
                      className="input"
                    >
                      <option value="">Use active resume</option>
                      {resumes.map((resume) => (
                        <option key={resume.id} value={resume.id}>
                          {resume.filename} {resume.isActive ? '(Active)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {newTemplate.attachResume && resumes.length === 0 && (
                  <p className="text-sm text-surface-500">
                    No resumes uploaded. Upload a resume in the Resume section above.
                  </p>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateTemplate}
                  disabled={isSavingTemplate}
                  className="btn-primary"
                >
                  {isSavingTemplate ? 'Creating...' : 'Create Template'}
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null });
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Template Modal/Popup */}
      {(selectedTemplate || showDefaultTemplate) && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2xl shadow-soft-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-surface-200">
                <h3 className="text-lg font-semibold text-surface-900">
                  {showDefaultTemplate ? 'Default Template' : selectedTemplate?.name}
                </h3>
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setShowDefaultTemplate(false);
                    setEditingTemplate(null);
                  }}
                  className="p-2 text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showDefaultTemplate ? (
                /* Default Template View (read-only) */
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Subject</label>
                    <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-lg text-surface-700">
                      {DEFAULT_TEMPLATE.subject}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Body</label>
                    <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-lg text-surface-700 whitespace-pre-wrap">
                      {DEFAULT_TEMPLATE.body}
                    </div>
                  </div>
                  <div className="p-4 bg-surface-100 rounded-xl">
                    <p className="text-xs font-semibold text-surface-700 mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((placeholder) => (
                        <span key={placeholder} className="text-xs px-2.5 py-1 bg-primary-100 text-primary-700 rounded-full font-medium">
                          {placeholder}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-sm text-surface-500">
                    This is the default template. Create a new template to customize your outreach emails.
                  </p>
                </div>
              ) : selectedTemplate && editingTemplate?.id === selectedTemplate.id ? (
                /* Edit Mode */
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Template Name</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Subject</label>
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Body</label>
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                      rows={8}
                      className="input resize-none"
                    />
                  </div>
                  {/* Detected Placeholders */}
                  <div className="p-4 bg-surface-100 rounded-xl">
                    <p className="text-xs font-semibold text-surface-700 mb-2">Detected Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {extractPlaceholders(editingTemplate.subject + ' ' + editingTemplate.body).map((placeholder) => (
                        <span
                          key={placeholder}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            DEFAULT_PLACEHOLDERS.includes(placeholder)
                              ? 'bg-primary-100 text-primary-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {placeholder}
                          {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                            <span className="ml-1 opacity-70">(custom)</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-surface-500 mt-3">
                      Default placeholders are auto-filled from your profile. Custom placeholders need manual input when sending.
                    </p>
                  </div>
                  {/* Resume Attachment */}
                  <div className="space-y-3 pt-4 border-t border-surface-200">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingTemplate.attachResume}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, attachResume: e.target.checked, resumeId: e.target.checked ? editingTemplate.resumeId : null })}
                        className="w-4 h-4 text-primary-600 border-surface-300 rounded focus:ring-primary-500"
                      />
                      <span className="text-sm font-medium text-surface-700">
                        Attach resume to emails using this template
                      </span>
                    </label>
                    {editingTemplate.attachResume && resumes.length > 0 && (
                      <select
                        value={editingTemplate.resumeId || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, resumeId: e.target.value || null })}
                        className="input"
                      >
                        <option value="">Use active resume</option>
                        {resumes.map((resume) => (
                          <option key={resume.id} value={resume.id}>
                            {resume.filename} {resume.isActive ? '(Active)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {/* Action Buttons */}
                  <div className="flex gap-3 pt-5 border-t border-surface-200">
                    <button
                      onClick={async () => {
                        await handleUpdateTemplate();
                        if (!templateError) {
                          setSelectedTemplate({ ...editingTemplate });
                        }
                      }}
                      disabled={isSavingTemplate}
                      className="btn-primary"
                    >
                      {isSavingTemplate ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(null)}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : selectedTemplate ? (
                /* View Mode */
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    {selectedTemplate.isDefault && (
                      <span className="badge-primary">
                        Default
                      </span>
                    )}
                    {selectedTemplate.attachResume && (
                      <span className="badge-success">
                        Resume Attached
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Subject</label>
                    <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-lg text-surface-700">
                      {selectedTemplate.subject || '(No subject)'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Body</label>
                    <div className="px-4 py-3 bg-surface-50 border border-surface-200 rounded-lg text-surface-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {selectedTemplate.body}
                    </div>
                  </div>
                  {/* Detected Placeholders */}
                  <div className="p-4 bg-surface-100 rounded-xl">
                    <p className="text-xs font-semibold text-surface-700 mb-2">Placeholders in this template:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {extractPlaceholders(selectedTemplate.subject + ' ' + selectedTemplate.body).length > 0 ? (
                        extractPlaceholders(selectedTemplate.subject + ' ' + selectedTemplate.body).map((placeholder) => (
                          <span
                            key={placeholder}
                            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                              DEFAULT_PLACEHOLDERS.includes(placeholder)
                                ? 'bg-primary-100 text-primary-700'
                                : 'bg-purple-100 text-purple-700'
                            }`}
                          >
                            {placeholder}
                            {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                              <span className="ml-1 opacity-70">(custom)</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-surface-500">No placeholders</span>
                      )}
                    </div>
                  </div>
                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-3 pt-5 border-t border-surface-200">
                    <button
                      onClick={() => setEditingTemplate(selectedTemplate)}
                      className="btn-primary"
                    >
                      Edit Template
                    </button>
                    {!selectedTemplate.isDefault && (
                      <>
                        <button
                          onClick={() => handleSetDefault(selectedTemplate.id)}
                          className="btn-secondary text-primary-600 border-primary-300 hover:bg-primary-50"
                        >
                          Set as Default
                        </button>
                        <button
                          onClick={() => {
                            handleDeleteTemplate(selectedTemplate.id);
                            setSelectedTemplate(null);
                          }}
                          className="btn-secondary text-red-600 border-red-300 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Sign Out Section */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-surface-900 mb-4">Account</h2>
        <p className="text-sm text-surface-500 mb-4">
          Sign out of your Lattice account. You can always sign back in later.
        </p>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-all shadow-sm hover:shadow-md"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign Out
        </button>
      </div>
    </div>
  );
}
