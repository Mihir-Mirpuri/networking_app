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
import {
  createCheckoutSession,
  createCustomerPortalSession,
  getSubscriptionStatus,
} from '@/app/actions/subscription';
import { SearchableCombobox } from '@/components/search/SearchableCombobox';
import { UNIVERSITIES, CLASSIFICATIONS } from '@/lib/constants';

type ProfileTab = 'profile' | 'resumes' | 'templates' | 'billing' | 'settings';

interface ProfileClientProps {
  userEmail: string;
  userName: string;
  userImage: string;
  activeTab?: ProfileTab;
}

const DEFAULT_TEMPLATE = {
  name: 'Default Template',
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

  // Subscription state
  const [subscription, setSubscription] = useState<{
    isSubscribed: boolean;
    currentPeriodEnd?: Date | null;
  }>({ isSubscribed: false });
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(true);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [isPortalLoading, setIsPortalLoading] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      loadProfile();
      loadTemplates();
      loadResumes();
      loadSubscription();
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

  const loadSubscription = async () => {
    setIsLoadingSubscription(true);
    const result = await getSubscriptionStatus();
    setSubscription({
      isSubscribed: result.isSubscribed ?? false,
      currentPeriodEnd: result.currentPeriodEnd,
    });
    setIsLoadingSubscription(false);
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
    signOut({ callbackUrl: '/app' });
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
    profile: { title: 'Profile', subtitle: 'Manage your personal information and preferences' },
    resumes: { title: 'Resumes', subtitle: 'Upload and manage your resumes' },
    templates: { title: 'Templates', subtitle: 'Create and manage email templates' },
    billing: { title: 'Plan & Billing', subtitle: 'Manage your subscription and billing' },
    settings: { title: 'Settings', subtitle: 'Account preferences and settings' },
  };

  const currentTab = activeTab || 'profile';
  const tabInfo = TAB_TITLES[currentTab] || TAB_TITLES.profile;

  return (
    <div className="text-white p-8 sm:p-10 max-w-4xl">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{tabInfo.title}</h1>
          <p className="text-[#606060] text-[13px] mt-1">{tabInfo.subtitle}</p>
        </div>
        {currentTab === 'profile' && (
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-6 py-2.5 rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
          >
            {isSavingProfile ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </header>

      {profileSaved && (
        <div className="mb-6 px-4 py-3 bg-green-900/30 text-green-400 rounded-lg text-sm flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Profile saved successfully!
        </div>
      )}

      {profileError && (
        <div className="mb-6 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">
          {profileError}
        </div>
      )}

      <div className="space-y-6">

        {/* Profile Section */}
        {currentTab === 'profile' && (
        <div>
          {isLoadingProfile ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-20 bg-[#2a2a2a] rounded" />
                    <div className="h-11 bg-[#111111] rounded-lg" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-20 bg-[#2a2a2a] rounded" />
                    <div className="h-11 bg-[#111111] rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Row 1: Name + Email */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">Full Name</label>
                  <input
                    type="text"
                    value={profile.name || ''}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full h-11 bg-[#111111] border-none rounded-lg text-[13px] text-[#E0E0E0] px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
                    placeholder="Your full name"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">Email</label>
                  <div className="flex items-center gap-2 h-11 bg-[#111111] rounded-lg px-4">
                    <svg className="w-3 h-3 text-[#404040] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    <span className="text-[13px] text-[#505050]">{userEmail}</span>
                  </div>
                </div>
              </div>

              {/* Row 2: University + Classification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">University</label>
                  <SearchableCombobox
                    options={UNIVERSITIES}
                    value={profile.university || ''}
                    onChange={(value) => setProfile({ ...profile, university: value })}
                    label=""
                    placeholder="Search universities..."
                    id="university"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">Classification</label>
                  <select
                    value={profile.classification || ''}
                    onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
                    className="w-full h-11 bg-[#111111] border-none rounded-lg text-[13px] text-[#E0E0E0] px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors appearance-none"
                  >
                    <option value="">Select classification</option>
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Major + Career */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">Major</label>
                  <input
                    type="text"
                    value={profile.major || ''}
                    onChange={(e) => setProfile({ ...profile, major: e.target.value })}
                    className="w-full h-11 bg-[#111111] border-none rounded-lg text-[13px] text-[#E0E0E0] px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
                    placeholder="e.g., Computer Science"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#707070]">Career Interest</label>
                  <input
                    type="text"
                    value={profile.career || ''}
                    onChange={(e) => setProfile({ ...profile, career: e.target.value })}
                    className="w-full h-11 bg-[#111111] border-none rounded-lg text-[13px] text-[#E0E0E0] px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
                    placeholder="e.g., Investment Banking, Consulting"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Settings Section */}
        {currentTab === 'settings' && (
        <div className="space-y-5">
          {/* Email Style Instructions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-[#707070]">Email Style Instructions</label>
            <textarea
              value={profile.emailInstructions || ''}
              onChange={(e) => setProfile({ ...profile, emailInstructions: e.target.value || null })}
              rows={3}
              className="w-full bg-[#111111] border-none rounded-lg text-[13px] text-[#909090] p-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors resize-none leading-relaxed"
              placeholder="e.g. Keep emails under 3 sentences. Always mention I'm looking for a summer internship."
            />
            <p className="text-[10px] text-[#505050]">These instructions will be applied to every AI-generated email.</p>
          </div>

          {/* Auto-Personalize Toggle */}
          <div className="flex items-center justify-between p-4 bg-[#111111] rounded-lg">
            <div className="space-y-0.5">
              <span className="text-[13px] font-medium text-[#E0E0E0]">Auto-Personalize Emails</span>
              <p className="text-[11px] text-[#505050]">
                Automatically personalize emails with AI when opening review
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={profile.autoPersonalize}
              onClick={() => setProfile({ ...profile, autoPersonalize: !profile.autoPersonalize })}
              className={`relative inline-flex h-[22px] w-10 items-center rounded-full transition-colors shrink-0 ${
                profile.autoPersonalize ? 'bg-[#6364FF]' : 'bg-[#303030]'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  profile.autoPersonalize ? 'translate-x-[22px]' : 'translate-x-[3px]'
                }`}
              />
            </button>
          </div>

          {/* Save */}
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-6 py-2.5 rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
          >
            {isSavingProfile ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        )}

        {/* Resume Card */}
        {currentTab === 'resumes' && (
        <section className="bg-[#1a1a1a] p-6 rounded-2xl border border-[#252525] card-shadow">
          <h3 className="text-lg font-bold text-white mb-4">Resume</h3>

          {resumeSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-900/30 text-green-400 rounded-lg text-sm">
              Resume uploaded successfully!
            </div>
          )}

          {resumeError && (
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">
              {resumeError}
            </div>
          )}

          {/* Upload Area */}
          <label className="border-2 border-dashed border-[#252525] rounded-xl p-4 flex items-center gap-4 group hover:border-[#606060] transition-colors cursor-pointer mb-4 block">
            <div className="bg-white/5 p-3 rounded-full text-[#808080] group-hover:scale-110 transition-transform">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-white text-sm">
                {isUploadingResume ? 'Uploading...' : 'Upload New Resume'}
              </p>
              <p className="text-xs text-[#909090]">PDF, DOCX (Max 10MB)</p>
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
            <div className="text-center py-4 text-[#909090] text-sm">Loading resumes...</div>
          ) : resumes.length === 0 ? (
            <div className="text-center py-4 text-[#808080] text-sm">No resumes uploaded yet</div>
          ) : (
            <div className="space-y-2">
              {resumes.map((resume) => (
                <div
                  key={resume.id}
                  className={`p-3 rounded-xl flex items-center gap-3 ${
                    resume.isActive ? 'bg-white/5' : 'bg-[#111111]'
                  }`}
                >
                  <div className="bg-[#1a1a1a] p-3 rounded-lg shadow-sm">
                    <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
                    </svg>
                  </div>
                  <div className="flex-grow min-w-0">
                    <p className="font-semibold text-sm text-white truncate">
                      {resume.filename}
                      {resume.isActive && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 bg-white/10 text-[#808080] rounded">
                          Active
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#808080]">
                      Uploaded {formatDate(resume.uploadedAt)} • {formatFileSize(resume.fileSize)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!resume.isActive && (
                      <button
                        onClick={() => handleSetActiveResume(resume.id)}
                        className="p-2 hover:bg-[#252525] rounded-lg text-[#909090] transition-colors"
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
                      className="p-2 hover:bg-[#252525] rounded-lg text-[#909090] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </a>
                    <button
                      onClick={() => handleDeleteResume(resume.id)}
                      className="p-2 hover:bg-red-900/30 rounded-lg text-[#808080] hover:text-red-400 transition-colors"
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
        )}

        {/* Email Templates Card */}
        {currentTab === 'templates' && (
        <section className="bg-[#1a1a1a] p-6 rounded-2xl border border-[#252525] card-shadow">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-bold text-white">Email Templates</h3>
            {!isCreating && (
              <button
                onClick={() => setIsCreating(true)}
                className="text-[#808080] text-sm font-semibold flex items-center gap-1 hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Template
              </button>
            )}
          </div>

          {templateError && (
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">
              {templateError}
            </div>
          )}

          {isLoadingTemplates ? (
            <div className="text-center py-4 text-[#909090] text-sm">Loading templates...</div>
          ) : (
            <div className="space-y-3">
              {/* Built-in Default Template Template (always shown) */}
              <button
                onClick={() => setShowDefaultTemplate(true)}
                className="group w-full text-left bg-[#1a1a1a] border border-[#252525] p-4 rounded-xl hover:border-[#606060]/50 transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-white">Default Template</h4>
                    <span className="bg-white/5 text-[#808080] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                      Built-in
                    </span>
                    {!templates.some(t => t.isDefault) && (
                      <span className="bg-white/5 text-[#808080] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                        Default
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-[#909090] line-clamp-2">
                  AI generates a unique personalized email for each recipient based on their background and your profile.
                </p>
              </button>

              {/* User Templates */}
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="group relative bg-[#1a1a1a] border border-[#252525] p-4 rounded-xl hover:border-[#606060]/50 transition-all"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-white">{template.name}</h4>
                      {template.isDefault && (
                        <span className="bg-white/5 text-[#808080] text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                          Default
                        </span>
                      )}
                      {template.attachResume && (
                        <span className="bg-green-900/30 text-green-400 text-[10px] px-2 py-0.5 rounded-full font-bold uppercase">
                          Resume
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setSelectedTemplate(template)}
                        className="p-1.5 hover:bg-[#1a1a1a] rounded-lg text-[#909090]"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(template.id)}
                        className="p-1.5 hover:bg-red-900/30 rounded-lg text-[#808080] hover:text-red-400"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#909090] line-clamp-2">{template.body}</p>
                </div>
              ))}

              {/* Add Template Button */}
              {!isCreating && (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full py-3 border-2 border-dashed border-[#252525] rounded-xl text-[#808080] hover:text-[#c0c0c0] hover:border-[#606060] transition-all flex items-center justify-center gap-2 font-medium text-sm"
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
            <div className="mt-3 p-4 border border-[#252525] rounded-xl bg-[#1a1a1a]">
              <h4 className="font-semibold text-white mb-4">New Template</h4>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Name</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    className="w-full bg-[#1a1a1a] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    placeholder="Template name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Subject</label>
                  <input
                    type="text"
                    value={newTemplate.subject}
                    onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                    className="w-full bg-[#1a1a1a] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    placeholder="Email subject"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Body</label>
                  <textarea
                    value={newTemplate.body}
                    onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                    rows={4}
                    className="w-full bg-[#1a1a1a] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3 resize-none"
                    placeholder="Email body"
                  />
                </div>
                <div className="p-3 bg-[#111111] rounded-xl">
                  <p className="text-xs font-semibold text-[#c0c0c0] mb-2">Available Placeholders:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_PLACEHOLDERS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewTemplate({ ...newTemplate, body: newTemplate.body + p })}
                        className="text-xs px-2.5 py-1 bg-white/10 text-[#808080] rounded-full font-medium hover:bg-white/15 transition-colors cursor-pointer"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                {resumes.length > 0 && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newTemplate.attachResume}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const activeResume = resumes.find((r) => r.isActive);
                          setNewTemplate({
                            ...newTemplate,
                            attachResume: checked,
                            resumeId: checked ? (activeResume?.id || resumes[0]?.id || null) : null,
                          });
                        }}
                        className="w-4 h-4 text-[#808080] border-[#303030] rounded focus:ring-[#505050]"
                      />
                      <span className="text-sm text-[#c0c0c0]">Attach resume</span>
                    </label>
                    {newTemplate.attachResume && (
                      <select
                        value={newTemplate.resumeId || ''}
                        onChange={(e) => setNewTemplate({ ...newTemplate, resumeId: e.target.value || null })}
                        className="w-full bg-[#1a1a1a] border border-[#252525] rounded-lg text-sm p-2"
                      >
                        {resumes.map((resume) => (
                          <option key={resume.id} value={resume.id}>
                            {resume.filename} {resume.isActive ? '(Active)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleCreateTemplate}
                    disabled={isSavingTemplate}
                    className="bg-[#505050] text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-[#606060] transition-all disabled:opacity-50 text-sm"
                  >
                    {isSavingTemplate ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false);
                      setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null });
                    }}
                    className="px-6 py-2.5 rounded-xl font-semibold hover:bg-[#1a1a1a] transition-all text-sm text-[#b0b0b0]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        {/* Plan & Billing Card */}
        {currentTab === 'billing' && (
        <section className="bg-[#1a1a1a] p-6 rounded-2xl border border-[#252525] card-shadow">
          <h3 className="text-lg font-bold text-white mb-4">Plan & Billing</h3>
          {isLoadingSubscription ? (
            <div className="text-center py-4 text-[#909090] text-sm">Loading plan details...</div>
          ) : subscription.isSubscribed ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg text-white font-bold text-xs">
                  PRO
                </span>
                <span className="text-sm text-[#c0c0c0] font-medium">Unlimited emails</span>
              </div>
              {subscription.currentPeriodEnd && (
                <p className="text-sm text-[#909090]">
                  Next billing date: {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              )}
              <button
                onClick={async () => {
                  setIsPortalLoading(true);
                  try {
                    await createCustomerPortalSession();
                  } catch {
                    setIsPortalLoading(false);
                  }
                }}
                disabled={isPortalLoading}
                className="px-6 py-2.5 rounded-xl font-semibold border border-[#252525] hover:bg-[#111111] transition-all text-[#c0c0c0] text-sm disabled:opacity-50"
              >
                {isPortalLoading ? 'Loading...' : 'Manage Billing'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-1 bg-[#1a1a1a] rounded-lg text-[#b0b0b0] font-bold text-xs">
                  FREE
                </span>
                <span className="text-sm text-[#c0c0c0] font-medium">10 emails/day</span>
              </div>
              <p className="text-sm text-[#909090]">
                Upgrade to Pro for unlimited emails at $20/month.
              </p>
              <button
                onClick={async () => {
                  setIsCheckoutLoading(true);
                  try {
                    await createCheckoutSession();
                  } catch {
                    setIsCheckoutLoading(false);
                  }
                }}
                disabled={isCheckoutLoading}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-indigo-700 transition-all shadow-sm hover:shadow-md text-sm disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {isCheckoutLoading ? 'Loading...' : 'Upgrade to Pro'}
              </button>
            </div>
          )}
        </section>
        )}

      </div>

      {/* Template Modal */}
      {(selectedTemplate || showDefaultTemplate) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#252525]">
                <h3 className="text-lg font-bold text-white">
                  {showDefaultTemplate ? 'Default Template' : selectedTemplate?.name}
                </h3>
                <button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setShowDefaultTemplate(false);
                    setEditingTemplate(null);
                  }}
                  className="p-2 text-[#808080] hover:text-[#b0b0b0] hover:bg-[#1a1a1a] rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showDefaultTemplate ? (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Subject</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-[#c0c0c0] text-sm">
                      {DEFAULT_TEMPLATE.subject}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Body</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-[#c0c0c0] text-sm whitespace-pre-wrap">
                      {DEFAULT_TEMPLATE.body}
                    </div>
                  </div>
                  <div className="p-4 bg-[#111111] rounded-xl">
                    <p className="text-xs font-semibold text-[#c0c0c0] mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((p) => (
                        <span key={p} className="text-xs px-2.5 py-1 bg-white/10 text-[#808080] rounded-full font-medium">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : selectedTemplate && editingTemplate?.id === selectedTemplate.id ? (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Name</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Subject</label>
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Body</label>
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                      rows={8}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3 resize-none"
                    />
                  </div>
                  <div className="p-3 bg-[#111111] rounded-xl">
                    <p className="text-xs font-semibold text-[#c0c0c0] mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, body: editingTemplate.body + p })}
                          className="text-xs px-2.5 py-1 bg-white/10 text-[#808080] rounded-full font-medium hover:bg-white/15 transition-colors cursor-pointer"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  {resumes.length > 0 && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingTemplate.attachResume}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            const activeResume = resumes.find((r) => r.isActive);
                            setEditingTemplate({
                              ...editingTemplate,
                              attachResume: checked,
                              resumeId: checked ? (editingTemplate.resumeId || activeResume?.id || resumes[0]?.id || null) : null,
                            });
                          }}
                          className="w-4 h-4 text-[#808080] border-[#303030] rounded"
                        />
                        <span className="text-sm text-[#c0c0c0]">Attach resume</span>
                      </label>
                      {editingTemplate.attachResume && (
                        <select
                          value={editingTemplate.resumeId || ''}
                          onChange={(e) => setEditingTemplate({ ...editingTemplate, resumeId: e.target.value || null })}
                          className="w-full bg-[#1a1a1a] border border-[#252525] rounded-lg text-sm p-2"
                        >
                          {resumes.map((resume) => (
                            <option key={resume.id} value={resume.id}>
                              {resume.filename} {resume.isActive ? '(Active)' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <div className="flex gap-3 pt-5 border-t border-[#252525]">
                    <button
                      onClick={async () => {
                        await handleUpdateTemplate();
                        if (!templateError) setSelectedTemplate({ ...editingTemplate });
                      }}
                      disabled={isSavingTemplate}
                      className="bg-[#505050] text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-[#606060] transition-all disabled:opacity-50"
                    >
                      {isSavingTemplate ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      onClick={() => setEditingTemplate(null)}
                      className="px-6 py-2.5 rounded-xl font-semibold hover:bg-[#1a1a1a] transition-all text-[#b0b0b0]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : selectedTemplate ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    {selectedTemplate.isDefault && (
                      <span className="bg-white/10 text-[#808080] text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Default</span>
                    )}
                    {selectedTemplate.attachResume && (
                      <span className="bg-green-900/30 text-green-400 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Resume</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Subject</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-[#c0c0c0] text-sm">
                      {selectedTemplate.subject || '(No subject)'}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#909090]">Body</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-[#c0c0c0] text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {selectedTemplate.body}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-5 border-t border-[#252525]">
                    <button
                      onClick={() => setEditingTemplate(selectedTemplate)}
                      className="bg-[#505050] text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-[#606060] transition-all"
                    >
                      Edit Template
                    </button>
                    {!selectedTemplate.isDefault && (
                      <button
                        onClick={() => handleSetDefault(selectedTemplate.id)}
                        className="px-6 py-2.5 rounded-xl font-semibold border border-[#252525] hover:bg-[#111111] transition-all text-[#c0c0c0]"
                      >
                        Set as Default
                      </button>
                    )}
                    <button
                      onClick={() => {
                        handleDeleteTemplate(selectedTemplate.id);
                        setSelectedTemplate(null);
                      }}
                      className="px-6 py-2.5 rounded-xl font-semibold border border-red-900/50 hover:bg-red-900/30 transition-all text-red-400"
                    >
                      Delete
                    </button>
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
