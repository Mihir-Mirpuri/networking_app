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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      {/* Profile Info Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center gap-4 mb-6">
          {userImage ? (
            <img
              src={userImage}
              alt={userName || 'Profile'}
              className="w-16 h-16 rounded-full"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center">
              <span className="text-2xl text-white font-medium">
                {(userName || userEmail || '?')[0].toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <p className="text-gray-600">{userEmail}</p>
            <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
              Google
            </span>
          </div>
        </div>

        {profileSaved && (
          <div className="mb-4 px-4 py-2 bg-green-100 text-green-800 rounded">
            Profile saved successfully!
          </div>
        )}

        {profileError && (
          <div className="mb-4 px-4 py-2 bg-red-100 text-red-800 rounded">
            {profileError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              value={profile.name || ''}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="classification" className="block text-sm font-medium text-gray-700 mb-1">
              Classification
            </label>
            <select
              id="classification"
              value={profile.classification || ''}
              onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Major
            </label>
            <input
              type="text"
              value={profile.major || ''}
              onChange={(e) => setProfile({ ...profile, major: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Career Interest
            </label>
            <input
              type="text"
              value={profile.career || ''}
              onChange={(e) => setProfile({ ...profile, career: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="e.g., Investment Banking, Consulting"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile || isLoadingProfile}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isSavingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Resume Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Resume</h2>

        {resumeSuccess && (
          <div className="mb-4 px-4 py-2 bg-green-100 text-green-800 rounded">
            Resume uploaded successfully!
          </div>
        )}

        {resumeError && (
          <div className="mb-4 px-4 py-2 bg-red-100 text-red-800 rounded">
            {resumeError}
          </div>
        )}

        {/* Upload Section */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Resume
          </label>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleUploadResume}
            disabled={isUploadingResume}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            Accepted formats: PDF, DOC, DOCX (Max 10MB)
          </p>
          {isUploadingResume && (
            <p className="mt-2 text-sm text-blue-600">Uploading...</p>
          )}
        </div>

        {/* Resumes List */}
        {isLoadingResumes ? (
          <div className="text-center py-4 text-gray-500">Loading resumes...</div>
        ) : resumes.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No resumes uploaded yet.</p>
            <p className="text-sm mt-1">Upload your first resume above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {resumes.map((resume) => (
              <div
                key={resume.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-blue-600"
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
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {resume.filename}
                      </p>
                      {resume.isActive && (
                        <span className="flex-shrink-0 text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>{formatFileSize(resume.fileSize)}</span>
                      <span>•</span>
                      <span>{formatDate(resume.uploadedAt)}</span>
                      <span>•</span>
                      <span>Version {resume.version}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {!resume.isActive && (
                    <button
                      onClick={() => handleSetActiveResume(resume.id)}
                      className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md"
                    >
                      Set Active
                    </button>
                  )}
                  <a
                    href={`/api/resume/view?id=${resume.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md"
                  >
                    View
                  </a>
                  <button
                    onClick={() => handleDeleteResume(resume.id)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md"
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Templates</h2>

        {templateError && (
          <div className="mb-4 px-4 py-2 bg-red-100 text-red-800 rounded">
            {templateError}
          </div>
        )}

        {/* Templates List - Just Names */}
        {isLoadingTemplates ? (
          <div className="text-center py-8 text-gray-500">Loading templates...</div>
        ) : (
          <div className="space-y-2">
            {/* Default Template (shown when no templates exist or as first option) */}
            {templates.length === 0 && (
              <button
                onClick={() => setShowDefaultTemplate(true)}
                className="w-full text-left px-4 py-3 border rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">Default Template</span>
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                    Default
                  </span>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* User Templates */}
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplate(template)}
                className="w-full text-left px-4 py-3 border rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{template.name}</span>
                  {template.isDefault && (
                    <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                      Default
                    </span>
                  )}
                  {template.attachResume && (
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full">
                      Resume
                    </span>
                  )}
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {/* Add Template Button - Below all templates */}
            {!isCreating && (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
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
          <div className="mt-4 p-4 border border-blue-200 rounded-lg bg-blue-50">
            <h3 className="font-medium text-gray-900 mb-3">New Template</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={newTemplate.name}
                onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Template name"
              />
              <input
                type="text"
                value={newTemplate.subject}
                onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Email subject (use {placeholder} syntax)"
              />
              <textarea
                value={newTemplate.body}
                onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Email body (use {placeholder} syntax for dynamic content)"
              />
              {/* Detected Placeholders */}
              {(newTemplate.subject || newTemplate.body) && (
                <div className="p-3 bg-gray-100 rounded-md">
                  <p className="text-xs font-medium text-gray-700 mb-2">Detected Placeholders:</p>
                  <div className="flex flex-wrap gap-1">
                    {extractPlaceholders(newTemplate.subject + ' ' + newTemplate.body).length > 0 ? (
                      extractPlaceholders(newTemplate.subject + ' ' + newTemplate.body).map((placeholder) => (
                        <span
                          key={placeholder}
                          className={`text-xs px-2 py-1 rounded ${
                            DEFAULT_PLACEHOLDERS.includes(placeholder)
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {placeholder}
                          {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                            <span className="ml-1 text-purple-600">(custom)</span>
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-500">No placeholders detected</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Default placeholders (auto-filled): {DEFAULT_PLACEHOLDERS.join(', ')}
                  </p>
                </div>
              )}
              {/* Resume Attachment Section */}
              <div className="space-y-2 pt-2 border-t border-gray-200">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={newTemplate.attachResume}
                    onChange={(e) => setNewTemplate({ ...newTemplate, attachResume: e.target.checked, resumeId: e.target.checked ? newTemplate.resumeId : null })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Attach resume to emails using this template
                  </span>
                </label>
                {newTemplate.attachResume && resumes.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Select Resume
                    </label>
                    <select
                      value={newTemplate.resumeId || ''}
                      onChange={(e) => setNewTemplate({ ...newTemplate, resumeId: e.target.value || null })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  <p className="text-sm text-gray-500">
                    No resumes uploaded. Upload a resume in the Resume section above.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateTemplate}
                  disabled={isSavingTemplate}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSavingTemplate ? 'Creating...' : 'Create Template'}
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null });
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {showDefaultTemplate ? 'Default Template' : selectedTemplate?.name}
                </h3>
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setShowDefaultTemplate(false);
                    setEditingTemplate(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showDefaultTemplate ? (
                /* Default Template View (read-only) */
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                      {DEFAULT_TEMPLATE.subject}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700 whitespace-pre-wrap">
                      {DEFAULT_TEMPLATE.body}
                    </div>
                  </div>
                  <div className="p-3 bg-gray-100 rounded-md">
                    <p className="text-xs font-medium text-gray-700 mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1">
                      {DEFAULT_PLACEHOLDERS.map((placeholder) => (
                        <span key={placeholder} className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded">
                          {placeholder}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    This is the default template. Create a new template to customize your outreach emails.
                  </p>
                </div>
              ) : selectedTemplate && editingTemplate?.id === selectedTemplate.id ? (
                /* Edit Mode */
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {/* Detected Placeholders */}
                  <div className="p-3 bg-gray-100 rounded-md">
                    <p className="text-xs font-medium text-gray-700 mb-2">Detected Placeholders:</p>
                    <div className="flex flex-wrap gap-1">
                      {extractPlaceholders(editingTemplate.subject + ' ' + editingTemplate.body).map((placeholder) => (
                        <span
                          key={placeholder}
                          className={`text-xs px-2 py-1 rounded ${
                            DEFAULT_PLACEHOLDERS.includes(placeholder)
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {placeholder}
                          {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                            <span className="ml-1 text-purple-600">(custom)</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Default placeholders are auto-filled from your profile. Custom placeholders need manual input when sending.
                    </p>
                  </div>
                  {/* Resume Attachment */}
                  <div className="space-y-2 pt-2 border-t border-gray-200">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={editingTemplate.attachResume}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, attachResume: e.target.checked, resumeId: e.target.checked ? editingTemplate.resumeId : null })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        Attach resume to emails using this template
                      </span>
                    </label>
                    {editingTemplate.attachResume && resumes.length > 0 && (
                      <select
                        value={editingTemplate.resumeId || ''}
                        onChange={(e) => setEditingTemplate({ ...editingTemplate, resumeId: e.target.value || null })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={async () => {
                        await handleUpdateTemplate();
                        if (!templateError) {
                          setSelectedTemplate({ ...editingTemplate });
                        }
                      }}
                      disabled={isSavingTemplate}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSavingTemplate ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(null)}
                      className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : selectedTemplate ? (
                /* View Mode */
                <div className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    {selectedTemplate.isDefault && (
                      <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                        Default
                      </span>
                    )}
                    {selectedTemplate.attachResume && (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full">
                        Resume Attached
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
                      {selectedTemplate.subject || '(No subject)'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {selectedTemplate.body}
                    </div>
                  </div>
                  {/* Detected Placeholders */}
                  <div className="p-3 bg-gray-100 rounded-md">
                    <p className="text-xs font-medium text-gray-700 mb-2">Placeholders in this template:</p>
                    <div className="flex flex-wrap gap-1">
                      {extractPlaceholders(selectedTemplate.subject + ' ' + selectedTemplate.body).length > 0 ? (
                        extractPlaceholders(selectedTemplate.subject + ' ' + selectedTemplate.body).map((placeholder) => (
                          <span
                            key={placeholder}
                            className={`text-xs px-2 py-1 rounded ${
                              DEFAULT_PLACEHOLDERS.includes(placeholder)
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {placeholder}
                            {!DEFAULT_PLACEHOLDERS.includes(placeholder) && (
                              <span className="ml-1 text-purple-600">(custom)</span>
                            )}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-500">No placeholders</span>
                      )}
                    </div>
                  </div>
                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => setEditingTemplate(selectedTemplate)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Edit Template
                    </button>
                    {!selectedTemplate.isDefault && (
                      <>
                        <button
                          onClick={() => handleSetDefault(selectedTemplate.id)}
                          className="px-4 py-2 border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50"
                        >
                          Set as Default
                        </button>
                        <button
                          onClick={() => {
                            handleDeleteTemplate(selectedTemplate.id);
                            setSelectedTemplate(null);
                          }}
                          className="px-4 py-2 border border-red-300 text-red-600 rounded-md hover:bg-red-50"
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
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Account</h2>
        <button
          onClick={handleSignOut}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
