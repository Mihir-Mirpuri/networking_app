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
  const [carouselIndex, setCarouselIndex] = useState(0);

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
    resumes: { title: 'Attachments', subtitle: 'Upload and manage files to personalize your outreach' },
    templates: { title: 'Templates', subtitle: 'Browse and manage your email templates' },
    billing: { title: 'Billing', subtitle: 'Manage your subscription and payment details' },
    settings: { title: 'Settings', subtitle: 'Customize your application preferences' },
  };

  const currentTab = activeTab || 'profile';
  const tabInfo = TAB_TITLES[currentTab] || TAB_TITLES.profile;

  return (
    <div className="text-white px-8 sm:px-10 pt-4 pb-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{tabInfo.title}</h1>
          <p className="text-white text-[13px] mt-1">{tabInfo.subtitle}</p>
        </div>
        {currentTab === 'profile' && (
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-6 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors disabled:opacity-50"
          >
            {isSavingProfile ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        {currentTab === 'resumes' && (
          <label className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors cursor-pointer flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            {isUploadingResume ? 'Uploading...' : 'Upload File'}
            <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadResume} disabled={isUploadingResume} className="hidden" />
          </label>
        )}
        {currentTab === 'templates' && !isCreating && (
          <button
            onClick={() => setIsCreating(true)}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Create Template
          </button>
        )}
        {currentTab === 'settings' && (
          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            className="bg-[#6364FF] text-white text-[13px] font-semibold px-6 py-2.5 rounded-full hover:bg-[#5354EE] transition-colors disabled:opacity-50"
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
            <div className="space-y-5">
              {/* Row 1: Name + Email */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Full Name</label>
                  <input
                    type="text"
                    value={profile.name || ''}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    className="w-full h-11 bg-[#212121] border border-[#2a2a2a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
                    placeholder="Your full name"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Email</label>
                  <div className="flex items-center gap-2 h-11 bg-[#212121] border border-[#2a2a2a] rounded-lg px-4">
                    <svg className="w-3 h-3 text-[#404040] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    <span className="text-[13px] text-white">{userEmail}</span>
                  </div>
                </div>
              </div>

              {/* Row 2: University + Classification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">University</label>
                  <SearchableCombobox
                    options={UNIVERSITIES}
                    value={profile.university || ''}
                    onChange={(value) => setProfile({ ...profile, university: value })}
                    label=""
                    placeholder="Search universities..."
                    id="university"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Classification</label>
                  <select
                    value={profile.classification || ''}
                    onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
                    className="w-full h-11 bg-[#212121] border border-[#2a2a2a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors appearance-none"
                  >
                    <option value="">Select classification</option>
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3: Major + Career */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Major</label>
                  <input
                    type="text"
                    value={profile.major || ''}
                    onChange={(e) => setProfile({ ...profile, major: e.target.value })}
                    className="w-full h-11 bg-[#212121] border border-[#2a2a2a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
                    placeholder="e.g., Computer Science"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Career Interest</label>
                  <input
                    type="text"
                    value={profile.career || ''}
                    onChange={(e) => setProfile({ ...profile, career: e.target.value })}
                    className="w-full h-11 bg-[#212121] border border-[#2a2a2a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#404040] transition-colors"
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
        <div className="space-y-6">
          {/* Email Preferences */}
          <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-white">Email Preferences</h3>
              <p className="text-[12px] text-white mt-1">Configure your default email settings for outreach</p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-white">Email Style Instructions</label>
              <textarea
                value={profile.emailInstructions || ''}
                onChange={(e) => setProfile({ ...profile, emailInstructions: e.target.value || null })}
                rows={3}
                className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-[13px] text-white p-4 focus:outline-none focus:ring-1 focus:ring-[#6364FF] transition-colors resize-none leading-relaxed"
                placeholder="e.g. Keep emails under 3 sentences. Always mention I'm looking for a summer internship."
              />
              <p className="text-[10px] text-white">These instructions will be applied to every AI-generated email.</p>
            </div>

            {/* Auto-Personalize Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[13px] font-medium text-white">Auto-Personalize Emails</span>
                <p className="text-[11px] text-white">Automatically personalize emails with AI when opening review</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={profile.autoPersonalize}
                onClick={() => setProfile({ ...profile, autoPersonalize: !profile.autoPersonalize })}
                className={`relative inline-flex h-[22px] w-10 items-center rounded-full transition-colors shrink-0 ${
                  profile.autoPersonalize ? 'bg-[#6364FF]' : 'bg-[#3a3a3a]'
                }`}
              >
                <span className={`inline-block h-[18px] w-[18px] transform rounded-full transition-transform ${profile.autoPersonalize ? 'translate-x-[20px] bg-white' : 'translate-x-[2px] bg-[#707070]'}`} />
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-[#252525] border border-[#ef4444]/25 rounded-lg p-6 space-y-3">
            <h3 className="text-base font-semibold text-[#ef4444]">Danger Zone</h3>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[13px] font-medium text-white">Delete Account</span>
                <p className="text-[11px] text-white">Permanently delete your account and all associated data</p>
              </div>
              <button className="text-[12px] font-semibold text-[#ef4444] border border-[#ef4444] rounded-lg px-4 py-2 hover:bg-[#ef4444]/10 transition-colors">
                Delete Account
              </button>
            </div>
          </div>
        </div>
        )}

        {/* Attachments Grid */}
        {currentTab === 'resumes' && (
        <div>
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
                  <a
                    href={`/api/resume/view?id=${resume.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`relative w-full aspect-[3/4] rounded-md bg-[#F5F5F5] overflow-hidden flex flex-col p-3 gap-1.5 cursor-pointer transition-all hover:shadow-lg ${
                      resume.isActive
                        ? 'ring-2 ring-[#6364FF] shadow-[0_2px_12px_rgba(99,100,255,0.15)]'
                        : 'hover:ring-1 hover:ring-[#505050]'
                    }`}
                  >
                    {/* Mini document content preview */}
                    <div className="text-[6px] font-bold text-[#1a1a1a] tracking-wider uppercase">{(profile.name || userName || 'Name').toUpperCase()}</div>
                    <div className="w-full h-px bg-[#1a1a1a]" />
                    <div className="text-[3.5px] text-white">{userEmail}</div>
                    <div className="mt-1 text-[4px] font-bold text-[#1a1a1a] tracking-wide">EDUCATION</div>
                    <div className="text-[3.5px] text-white leading-relaxed">{profile.university || 'University'}<br/>{profile.major || 'Major'}</div>
                    <div className="mt-1 text-[4px] font-bold text-[#1a1a1a] tracking-wide">EXPERIENCE</div>
                    <div className="h-2 w-3/4 bg-[#e0e0e0] rounded-sm" />
                    <div className="h-2 w-full bg-[#ebebeb] rounded-sm" />
                    <div className="h-2 w-2/3 bg-[#e0e0e0] rounded-sm" />
                    <div className="mt-1 text-[4px] font-bold text-[#1a1a1a] tracking-wide">SKILLS</div>
                    <div className="h-2 w-4/5 bg-[#ebebeb] rounded-sm" />

                    {/* Hover overlay with actions */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      {!resume.isActive && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSetActiveResume(resume.id); }}
                          className="p-2 bg-[#6364FF] rounded-lg text-white hover:bg-[#5354EE] transition-colors"
                          title="Set as active"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      )}
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
                  </a>

                  {/* Filename */}
                  <p className="text-[11px] text-white font-medium truncate max-w-full text-center">{resume.filename}</p>

                  {/* Active badge */}
                  {resume.isActive && (
                    <span className="text-[9px] font-semibold text-[#6364FF] bg-[#6364FF]/15 px-2.5 py-0.5 rounded-full">Active</span>
                  )}
                </div>
              ))}

              {/* Upload new slot */}
              <label className="flex flex-col items-center gap-2 cursor-pointer group">
                <div className="w-full aspect-[3/4] rounded-md border border-dashed border-[#3a3a3a] flex flex-col items-center justify-center gap-2 hover:border-[#606060] transition-colors">
                  <svg className="w-6 h-6 text-white group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className="text-[10px] text-white group-hover:text-white font-medium transition-colors">Upload</span>
                </div>
                <input type="file" accept=".pdf,.doc,.docx" onChange={handleUploadResume} disabled={isUploadingResume} className="hidden" />
              </label>
            </div>
          )}
        </div>
        )}

        {/* Templates Carousel */}
        {currentTab === 'templates' && (
        <div>
          {templateError && (
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">{templateError}</div>
          )}

          {isLoadingTemplates ? (
            <div className="text-center py-12 text-white text-sm">Loading templates...</div>
          ) : isCreating ? (
            /* Create Template Form */
            <div className="max-w-2xl mx-auto p-6 bg-[#252525] border border-[#3a3a3a] rounded-xl">
              <h4 className="font-semibold text-white text-lg mb-5">New Template</h4>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Name</label>
                  <input type="text" value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} className="w-full h-11 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#6364FF]" placeholder="Template name" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Subject</label>
                  <input type="text" value={newTemplate.subject} onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })} className="w-full h-11 bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-[13px] text-white px-4 focus:outline-none focus:ring-1 focus:ring-[#6364FF]" placeholder="Email subject" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-white">Body</label>
                  <textarea value={newTemplate.body} onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })} rows={8} className="w-full bg-[#1a1a1a] border border-[#3a3a3a] rounded-lg text-[13px] text-white p-4 focus:outline-none focus:ring-1 focus:ring-[#6364FF] resize-none" placeholder="Email body" />
                </div>
                <div className="p-3 bg-[#1a1a1a] rounded-lg">
                  <p className="text-[10px] font-medium text-white mb-2">Placeholders:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFAULT_PLACEHOLDERS.map((p) => (
                      <button key={p} type="button" onClick={() => setNewTemplate({ ...newTemplate, body: newTemplate.body + p })} className="text-[10px] px-2 py-1 bg-[#252525] text-white rounded-full hover:bg-[#303030] transition-colors">{p}</button>
                    ))}
                  </div>
                </div>
                {resumes.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={newTemplate.attachResume} onChange={(e) => { const checked = e.target.checked; const active = resumes.find(r => r.isActive); setNewTemplate({ ...newTemplate, attachResume: checked, resumeId: checked ? (active?.id || resumes[0]?.id || null) : null }); }} className="w-4 h-4 rounded border-[#3a3a3a]" />
                    <span className="text-sm text-white">Attach resume</span>
                  </label>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={handleCreateTemplate} disabled={isSavingTemplate} className="bg-[#6364FF] text-white px-6 py-2.5 rounded-lg font-semibold text-sm hover:bg-[#5354EE] transition-colors disabled:opacity-50">{isSavingTemplate ? 'Creating...' : 'Create Template'}</button>
                  <button onClick={() => { setIsCreating(false); setNewTemplate({ name: '', subject: '', body: '', attachResume: false, resumeId: null }); }} className="px-6 py-2.5 rounded-lg text-sm text-white hover:text-white transition-colors">Cancel</button>
                </div>
              </div>
            </div>
          ) : (() => {
            /* Carousel view */
            const allTemplates = [
              { id: '__default__', name: 'Default Template', subject: DEFAULT_TEMPLATE.subject, body: DEFAULT_TEMPLATE.body, isDefault: !templates.some(t => t.isDefault), attachResume: false, resumeId: null },
              ...templates,
            ];
            const idx = Math.min(carouselIndex, allTemplates.length - 1);
            const current = allTemplates[idx];
            if (!current) return <div className="text-center py-12 text-white text-sm">No templates yet</div>;

            return (
              <div className="relative flex flex-col items-center" style={{ minHeight: 580 }}>
                {/* Card stack area */}
                <div className="relative mx-auto" style={{ width: 420, height: 540 }}>
                  {/* Back card 2 — rotated 3deg, offset right+down */}
                  {allTemplates.length > 2 && (
                    <div
                      className="absolute bg-[#252525] border border-[#3a3a3a] rounded-xl"
                      style={{ inset: 0, transform: 'rotate(3deg)', transformOrigin: 'center', left: 40, top: 20, opacity: 0.25 }}
                    />
                  )}
                  {/* Back card 1 — rotated 1.5deg, offset right+down */}
                  {allTemplates.length > 1 && (
                    <div
                      className="absolute bg-[#2a2a2a] border border-[#3a3a3a] rounded-xl"
                      style={{ inset: 0, transform: 'rotate(1.5deg)', transformOrigin: 'center', left: 20, top: 10, opacity: 0.5 }}
                    />
                  )}
                  {/* Front card */}
                  <div className="absolute inset-0 bg-[#252525] border-2 border-[#6364FF] rounded-xl flex flex-col overflow-hidden" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    {/* Card header */}
                    <div className="px-5 pt-5 pb-0 flex items-center justify-between">
                      <h3 className="text-[15px] font-semibold text-white">{current.name}</h3>
                      <div className="flex items-center gap-2">
                        {current.isDefault && (
                          <span className="text-[10px] font-semibold text-[#6364FF] bg-[#6364FF]/15 px-2.5 py-0.5 rounded-full">Default</span>
                        )}
                        {current.id !== '__default__' && (
                          <>
                            <button onClick={() => setSelectedTemplate(current as TemplateData)} className="p-1.5 text-white hover:text-white transition-colors" title="Edit">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                            </button>
                            <button onClick={() => handleDeleteTemplate(current.id)} className="p-1.5 text-white hover:text-[#ef4444] transition-colors" title="Delete">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Subject line */}
                    {current.subject && (
                      <div className="px-5 pt-3 flex items-center gap-1.5">
                        <span className="text-[11px] text-white font-medium">Subject:</span>
                        <span className="text-[11px] text-white">{current.subject}</span>
                      </div>
                    )}
                    {/* Divider */}
                    <div className="mx-5 my-3 h-px bg-[#3a3a3a]" />
                    {/* Email body */}
                    <div className="px-5 pb-5 flex-1 overflow-y-auto">
                      <p className="text-[13px] text-white whitespace-pre-wrap leading-[1.7]">{current.body}</p>
                    </div>
                    {/* Footer stats */}
                    <div className="px-5 pb-4">
                      <span className="text-[10px] text-white">Used {current.id === '__default__' ? 'as fallback' : '—'} · Last used recently</span>
                    </div>
                  </div>
                </div>

                {/* Left arrow — positioned at left edge of content area, vertically centered on card */}
                <button
                  onClick={() => setCarouselIndex(Math.max(0, idx - 1))}
                  disabled={idx === 0}
                  className="absolute w-9 h-9 rounded-full bg-[#252525] border border-[#3a3a3a] flex items-center justify-center text-white hover:bg-[#303030] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ left: 'calc(50% - 260px)', top: 270 }}
                >
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                {/* Right arrow */}
                <button
                  onClick={() => setCarouselIndex(Math.min(allTemplates.length - 1, idx + 1))}
                  disabled={idx === allTemplates.length - 1}
                  className="absolute w-9 h-9 rounded-full bg-[#252525] border border-[#3a3a3a] flex items-center justify-center text-white hover:bg-[#303030] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ right: 'calc(50% - 260px)', top: 270 }}
                >
                  <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>

                {/* Dots + counter */}
                <div className="flex flex-col items-center gap-2 mt-5">
                  <div className="flex gap-2 items-center">
                    {allTemplates.map((_, i) => (
                      <button key={i} onClick={() => setCarouselIndex(i)} className={`rounded-full transition-all ${i === idx ? 'w-2.5 h-2.5 bg-[#6364FF]' : 'w-2 h-2 bg-[#3a3a3a] hover:bg-[#505050]'}`} />
                    ))}
                  </div>
                  <span className="text-[11px] text-white">{idx + 1} of {allTemplates.length}</span>
                </div>
              </div>
            );
          })()}
        </div>
        )}

        {/* Billing */}
        {currentTab === 'billing' && (
        <div className="space-y-5">
          {isLoadingSubscription ? (
            <div className="text-center py-12 text-white text-sm">Loading plan details...</div>
          ) : (
            <>
              {/* Plan card */}
              <div className="flex items-center justify-between bg-[#252525] border border-[#3a3a3a] rounded-lg p-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-white">{subscription.isSubscribed ? 'PRO Plan' : 'Free Plan'}</span>
                    <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${subscription.isSubscribed ? 'bg-[#22C55E]/15 text-[#22C55E]' : 'bg-[#303030] text-white'}`}>
                      {subscription.isSubscribed ? 'Active' : 'Current'}
                    </span>
                  </div>
                  <p className="text-[13px] text-white">
                    {subscription.isSubscribed
                      ? `$20/month · Renews ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'soon'}`
                      : '10 emails/day · Free forever'}
                  </p>
                </div>
                {subscription.isSubscribed ? (
                  <button
                    onClick={async () => { setIsPortalLoading(true); try { await createCustomerPortalSession(); } catch { setIsPortalLoading(false); } }}
                    disabled={isPortalLoading}
                    className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
                  >
                    {isPortalLoading ? 'Loading...' : 'Manage Plan'}
                  </button>
                ) : (
                  <button
                    onClick={async () => { setIsCheckoutLoading(true); try { await createCheckoutSession(); } catch { setIsCheckoutLoading(false); } }}
                    disabled={isCheckoutLoading}
                    className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2.5 rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    {isCheckoutLoading ? 'Loading...' : 'Upgrade to Pro'}
                  </button>
                )}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-5 space-y-2">
                  <p className="text-[12px] text-white">Emails Sent</p>
                  <p className="text-xl font-bold text-white">{subscription.isSubscribed ? 'Unlimited' : '10/day'}</p>
                </div>
                <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-5 space-y-2">
                  <p className="text-[12px] text-white">Templates</p>
                  <p className="text-xl font-bold text-white">{templates.length}</p>
                </div>
                <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-5 space-y-2">
                  <p className="text-[12px] text-white">Attachments</p>
                  <p className="text-xl font-bold text-white">{resumes.length}</p>
                </div>
              </div>
            </>
          )}
        </div>
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
                  className="p-2 text-white hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showDefaultTemplate ? (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Subject</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-white text-sm">
                      {DEFAULT_TEMPLATE.subject}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Body</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-white text-sm whitespace-pre-wrap">
                      {DEFAULT_TEMPLATE.body}
                    </div>
                  </div>
                  <div className="p-4 bg-[#111111] rounded-xl">
                    <p className="text-xs font-semibold text-white mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((p) => (
                        <span key={p} className="text-xs px-2.5 py-1 bg-white/10 text-white rounded-full font-medium">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : selectedTemplate && editingTemplate?.id === selectedTemplate.id ? (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Name</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Subject</label>
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Body</label>
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                      rows={8}
                      className="w-full bg-[#111111] border-none rounded-lg focus:ring-2 focus:ring-[#505050] text-sm p-3 resize-none"
                    />
                  </div>
                  <div className="p-3 bg-[#111111] rounded-xl">
                    <p className="text-xs font-semibold text-white mb-2">Available Placeholders:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {DEFAULT_PLACEHOLDERS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEditingTemplate({ ...editingTemplate, body: editingTemplate.body + p })}
                          className="text-xs px-2.5 py-1 bg-white/10 text-white rounded-full font-medium hover:bg-white/15 transition-colors cursor-pointer"
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
                          className="w-4 h-4 text-white border-[#303030] rounded"
                        />
                        <span className="text-sm text-white">Attach resume</span>
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
                      className="px-6 py-2.5 rounded-xl font-semibold hover:bg-[#1a1a1a] transition-all text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : selectedTemplate ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-2">
                    {selectedTemplate.isDefault && (
                      <span className="bg-white/10 text-white text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Default</span>
                    )}
                    {selectedTemplate.attachResume && (
                      <span className="bg-green-900/30 text-green-400 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase">Resume</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Subject</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-white text-sm">
                      {selectedTemplate.subject || '(No subject)'}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-white">Body</label>
                    <div className="px-4 py-3 bg-[#111111] rounded-lg text-white text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
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
                        className="px-6 py-2.5 rounded-xl font-semibold border border-[#252525] hover:bg-[#111111] transition-all text-white"
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
