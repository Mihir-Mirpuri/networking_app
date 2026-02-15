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
  subject: '{university} {classification} interested in {industry} at {company}',
  body: `Hi {first_name},

I hope you are doing well. My name is {user_name} and I am a {classification} pursuing my {major} at {university}. I am interested in {career} and would love to grab 10-15 minutes on the phone with you to hear about your experiences at {company}.

In case it's helpful to provide more context on my background, I have attached my resume below for your reference. I look forward to hearing from you.

Warm regards,
{user_name}`,
};

const DEFAULT_PLACEHOLDERS = [
  '{first_name}',
  '{user_name}',
  '{company}',
  '{university}',
  '{classification}',
  '{major}',
  '{career}',
  '{role}',
  '{industry}',
];

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

  return (
    <div className="text-surface-900">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-surface-500 text-sm">Manage your professional information and career assets.</p>
      </header>

      {/* Masonry Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ alignItems: 'start' }}>

        {/* Profile Card */}
        <section className="bg-white p-6 rounded-2xl border border-surface-200 card-shadow">
          <div className="flex items-center gap-4 mb-6">
            {userImage ? (
              <img
                src={userImage}
                alt={userName || 'Profile'}
                className="w-16 h-16 rounded-full ring-2 ring-primary-500/20"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center ring-2 ring-primary-500/20">
                <span className="text-xl text-white font-semibold">{initials}</span>
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-surface-900">{profile.name || userName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-sm text-surface-500">{userEmail}</span>
                <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 bg-green-100 text-green-700 rounded">
                  Google Connected
                </span>
              </div>
            </div>
          </div>

          {profileSaved && (
            <div className="mb-6 px-4 py-3 bg-green-50 text-green-700 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Profile saved successfully!
            </div>
          )}

          {profileError && (
            <div className="mb-6 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {profileError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Full Name
              </label>
              <input
                type="text"
                value={profile.name || ''}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                disabled={isLoadingProfile}
                className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                placeholder="Your full name"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Classification
              </label>
              <select
                value={profile.classification || ''}
                onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
                disabled={isLoadingProfile}
                className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
              >
                <option value="">Select classification</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Major
              </label>
              <input
                type="text"
                value={profile.major || ''}
                onChange={(e) => setProfile({ ...profile, major: e.target.value })}
                disabled={isLoadingProfile}
                className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                placeholder="e.g., Computer Science"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                University
              </label>
              <SearchableCombobox
                options={UNIVERSITIES}
                value={profile.university || ''}
                onChange={(value) => setProfile({ ...profile, university: value })}
                label=""
                placeholder="Search universities..."
                id="university"
                disabled={isLoadingProfile}
              />
            </div>

            <div className="md:col-span-2 space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Career Interest
              </label>
              <input
                type="text"
                value={profile.career || ''}
                onChange={(e) => setProfile({ ...profile, career: e.target.value })}
                disabled={isLoadingProfile}
                className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                placeholder="e.g., Investment Banking, Consulting"
              />
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile || isLoadingProfile}
            className="mt-6 w-full md:w-auto bg-primary-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-600 transition-all disabled:opacity-50"
          >
            {isSavingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </section>

        {/* Resume Card */}
        <section className="bg-white p-6 rounded-2xl border border-surface-200 card-shadow">
          <h3 className="text-lg font-bold text-surface-900 mb-4">Resume</h3>

          {resumeSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-50 text-green-700 rounded-lg text-sm">
              Resume uploaded successfully!
            </div>
          )}

          {resumeError && (
            <div className="mb-4 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {resumeError}
            </div>
          )}

          {/* Upload Area */}
          <label className="border-2 border-dashed border-surface-200 rounded-xl p-4 flex items-center gap-4 group hover:border-primary-500 transition-colors cursor-pointer mb-4 block">
            <div className="bg-primary-500/10 p-3 rounded-full text-primary-500 group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-surface-900 text-sm">
                {isUploadingResume ? 'Uploading...' : 'Upload New Resume'}
              </p>
              <p className="text-xs text-surface-500">PDF, DOCX (Max 10MB)</p>
            </div>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleUploadResume}
              disabled={isUploadingResume}
              className="hidden"
            />
          </label>

          {/* Resumes List */}
          {isLoadingResumes ? (
            <div className="text-center py-4 text-surface-500 text-sm">Loading resumes...</div>
          ) : resumes.length === 0 ? (
            <div className="text-center py-4 text-surface-400 text-sm">No resumes uploaded yet</div>
          ) : (
            <div className="space-y-2">
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  className={`p-3 rounded-xl flex items-center gap-3 ${
                    resume.isActive ? 'bg-primary-50' : 'bg-surface-50'
                  }`}
                >
                  <div className="bg-white p-3 rounded-lg shadow-sm">
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                    </svg>
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="font-semibold text-sm text-surface-900 truncate">
                      {resume.filename}
                      {resume.isActive && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 bg-primary-100 text-primary-700 rounded">
                          Active
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-surface-400">
                      Uploaded {formatDate(resume.uploadedAt)} • {formatFileSize(resume.fileSize)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!resume.isActive && (
                      <button
                        onClick={() => handleSetActiveResume(resume.id)}
                        className="p-2 hover:bg-surface-200 rounded-lg text-surface-500 transition-colors"
                        title="Set as active"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                    )}
                    <a
                      href={`/api/resume/view?id=${resume.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-surface-200 rounded-lg text-surface-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </a>
                    <button
                      onClick={() => handleDeleteResume(resume.id)}
                      className="p-2 hover:bg-red-50 rounded-lg text-surface-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Email Templates Card */}
        <section className="bg-white p-6 rounded-2xl border border-surface-200 card-shadow">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-surface-900">Email Templates</h3>
            {!isCreating && (
              <button
                onClick={() => setIsCreating(true)}
                className="text-primary-500 text-sm font-semibold flex items-center gap-1 hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            )}
          </div>

          {templateError && (
            <div className="mb-4 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {templateError}
            </div>
          )}

          {isLoadingTemplates ? (
            <div className="text-center py-4 text-surface-500 text-sm">Loading templates...</div>
          ) : (
            <div className="space-y-3">
              {/* Default Template (when no user templates) */}
              {templates.length === 0 && (
                <button
                  onClick={() => setShowDefaultTemplate(true)}
                  className="group w-full text-left bg-white border border-surface-200 p-4 rounded-xl hover:border-primary-500/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-surface-900">Default Template</h4>
                      <span className="bg-primary-500/10 text-primary-500 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                        Default
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-surface-500 line-clamp-2">
                    Hi there, I&apos;m writing to express interest in learning more about your experiences...
                  </p>
                </button>
              )}

              {/* User Templates */}
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="group relative bg-white border border-surface-200 p-4 rounded-xl hover:border-primary-500/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-surface-900">{template.name}</h4>
                      {template.isDefault && (
                        <span className="bg-primary-500/10 text-primary-500 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                          Default
                        </span>
                      )}
                      {template.attachResume && (
                        <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                          Resume
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setSelectedTemplate(template)}
                        className="p-1.5 hover:bg-surface-100 rounded-lg text-surface-500"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      {!template.isDefault && (
                        <button
                          onClick={() => handleDeleteTemplate(template.id)}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-surface-400 hover:text-red-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-surface-500 line-clamp-2">{template.body}</p>
                </div>
              ))}

              {/* Add Template Button */}
              {!isCreating && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full py-3 border-2 border-dashed border-surface-200 rounded-xl text-surface-400 hover:text-primary-500 hover:border-primary-500 transition-all flex items-center justify-center gap-2 font-medium text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Add Another Template
                </button>
              )}
            </div>
          )}

          {/* Create Template Form */}
          {isCreating && (
            <div className="mt-3 p-4 border border-primary-200 rounded-xl bg-primary-50/50">
              <h4 className="font-semibold text-surface-900 mb-4">New Template</h4>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Name</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    className="w-full bg-white border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                    placeholder="Template name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Subject</label>
                  <input
                    type="text"
                    value={newTemplate.subject}
                    onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                    className="w-full bg-white border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                    placeholder="Email subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Body</label>
                  <textarea
                    value={newTemplate.body}
                    onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                    rows={4}
                    className="w-full bg-white border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3 resize-none"
                    placeholder="Email body"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newTemplate.attachResume}
                    onChange={(e) => setNewTemplate({ ...newTemplate, attachResume: e.target.checked })}
                    className="w-4 h-4 text-primary-500 border-surface-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-surface-700">Attach resume</span>
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={handleCreateTemplate}
                    disabled={isSavingTemplate}
                    className="bg-primary-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-600 transition-all disabled:opacity-50 text-sm"
                  >
                    {isSavingTemplate ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false);
                      setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null });
                    }}
                    className="px-6 py-2.5 rounded-xl font-semibold hover:bg-surface-100 transition-all text-sm text-surface-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Account Settings Card */}
        <section className="bg-white p-6 rounded-2xl border border-surface-200 card-shadow">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-surface-900">Account</h3>
              <p className="text-sm text-surface-500">Manage your session</p>
            </div>
            <button
              onClick={handleSignOut}
              className="bg-red-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-red-600 transition-all flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign Out
            </button>
          </div>
        </section>
      </div>

      {/* Template Modal */}
      {(selectedTemplate || showDefaultTemplate) && (
        <div className="fixed inset-0 bg-surface-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-surface-200">
                <h3 className="text-lg font-bold text-surface-900">
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
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Subject</label>
                    <div className="px-4 py-3 bg-surface-50 rounded-lg text-surface-700 text-sm">
                      {DEFAULT_TEMPLATE.subject}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Body</label>
                    <div className="px-4 py-3 bg-surface-50 rounded-lg text-surface-700 text-sm whitespace-pre-wrap">
                      {DEFAULT_TEMPLATE.body}
                    </div>
                  </div>
                  <div className="p-4 bg-surface-100 rounded-xl">
                    <p className="text-xs font-semibold text-surface-700 mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((p) => (
                        <span key={p} className="text-xs px-2.5 py-1 bg-primary-100 text-primary-700 rounded-full font-medium">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : selectedTemplate && editingTemplate?.id === selectedTemplate.id ? (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Name</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Subject</label>
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Body</label>
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                      rows={8}
                      className="w-full bg-surface-50 border-none rounded-lg focus:ring-2 focus:ring-primary-500 text-sm p-3 resize-none"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingTemplate.attachResume}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, attachResume: e.target.checked })}
                      className="w-4 h-4 text-primary-500 border-surface-300 rounded"
                    />
                    <span className="text-sm text-surface-700">Attach resume</span>
                  </label>
                  <div className="flex gap-3 pt-5 border-t border-surface-200">
                    <button
                      onClick={async () => {
                        await handleUpdateTemplate();
                        if (!templateError) setSelectedTemplate({ ...editingTemplate });
                      }}
                      disabled={isSavingTemplate}
                      className="bg-primary-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-600 transition-all disabled:opacity-50"
                    >
                      {isSavingTemplate ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(null)}
                      className="px-6 py-2.5 rounded-xl font-semibold hover:bg-surface-100 transition-all text-surface-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : selectedTemplate ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    {selectedTemplate.isDefault && (
                      <span className="bg-primary-100 text-primary-700 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Default</span>
                    )}
                    {selectedTemplate.attachResume && (
                      <span className="bg-green-100 text-green-700 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Resume</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Subject</label>
                    <div className="px-4 py-3 bg-surface-50 rounded-lg text-surface-700 text-sm">
                      {selectedTemplate.subject || '(No subject)'}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-surface-500">Body</label>
                    <div className="px-4 py-3 bg-surface-50 rounded-lg text-surface-700 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {selectedTemplate.body}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-5 border-t border-surface-200">
                    <button
                      onClick={() => setEditingTemplate(selectedTemplate)}
                      className="bg-primary-500 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-600 transition-all"
                    >
                      Edit Template
                    </button>
                    {!selectedTemplate.isDefault && (
                      <>
                        <button
                          onClick={() => handleSetDefault(selectedTemplate.id)}
                          className="px-6 py-2.5 rounded-xl font-semibold border border-surface-200 hover:bg-surface-50 transition-all text-surface-700"
                        >
                          Set as Default
                        </button>
                        <button
                          onClick={() => {
                            handleDeleteTemplate(selectedTemplate.id);
                            setSelectedTemplate(null);
                          }}
                          className="px-6 py-2.5 rounded-xl font-semibold border border-red-200 hover:bg-red-50 transition-all text-red-600"
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
    </div>
  );
}
