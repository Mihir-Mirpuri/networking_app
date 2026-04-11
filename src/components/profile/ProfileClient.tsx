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
  '{interview_date}',
  '{topics_discussed}',
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
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Resume state
  const [resumes, setResumes] = useState<ResumeData[]>([]);
  const [isLoadingResumes, setIsLoadingResumes] = useState(true);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeSuccess, setResumeSuccess] = useState(false);
  const [expandedResume, setExpandedResume] = useState<ResumeData | null>(null);
  const [loadedPdfs, setLoadedPdfs] = useState<Set<string>>(new Set());

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
        {currentTab === 'account' && (
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
        {currentTab === 'templates' && (
          <button
            onClick={() => setEditingTemplate({ id: '__new__', name: '', subject: '', body: '', isDefault: false, attachResume: false, resumeId: null, createdAt: new Date() })}
            className="bg-[#A855F7] text-white text-[13px] font-semibold px-5 py-2.5 rounded-full hover:bg-[#9333EA] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Create Template
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
                <button className="text-xs font-semibold text-[#ef4444] border border-[#ef4444]/40 rounded-lg px-5 py-2.5 hover:bg-[#ef4444]/10 transition-colors">
                  Delete
                </button>
              </div>
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
            <div className="mb-4 px-4 py-3 bg-red-900/30 text-red-400 rounded-lg text-sm">{templateError}</div>
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
              <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                {/* Table header */}
                <div className="flex items-center px-5 py-3 border-b border-[#2a2a2a] bg-[#1a1a1a]">
                  <span className="flex-1 text-xs font-semibold text-[#707070]">Template Name</span>
                  <span className="w-[120px] text-xs font-semibold text-[#707070]">Type</span>
                  <span className="w-[120px] text-xs font-semibold text-[#707070] text-right">Last Modified</span>
                  <span className="w-4 ml-3" />
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
                    className="flex items-center w-full px-5 py-3.5 gap-3 border-b border-[#2a2a2a] last:border-b-0 hover:bg-[#252525] transition-colors text-left"
                  >
                    <svg className={`w-4 h-4 shrink-0 ${template.isDefault ? 'text-[#A855F7]' : 'text-[#606060]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white truncate">{template.name}</p>
                      <p className="text-[11px] text-[#606060] truncate">{template.subject}</p>
                    </div>
                    <div className="w-[120px] flex justify-center">
                      {template.isDefault ? (
                        <span className="text-[11px] font-medium text-[#A855F7] bg-[#A855F7]/10 px-2.5 py-0.5 rounded-full">Default</span>
                      ) : (
                        <span className="text-[11px] font-medium text-[#606060] bg-[#1a1a1a] border border-[#2a2a2a] px-2.5 py-0.5 rounded-full">Custom</span>
                      )}
                    </div>
                    <span className="w-[120px] text-[12px] text-[#606060] text-right">
                      {template.createdAt ? new Date(template.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </span>
                    <svg className="w-4 h-4 text-[#606060] ml-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Email Preferences */}
          <div className="bg-[#252525] border border-[#3a3a3a] rounded-lg p-6 space-y-5 mt-6">
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

            <div className="flex justify-end">
              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="bg-[#6364FF] text-white text-[13px] font-semibold px-5 py-2 rounded-lg hover:bg-[#5354EE] transition-colors disabled:opacity-50"
              >
                {isSavingProfile ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        </div>
        )}

      </div>

      {/* Template Editor Modal */}
      {editingTemplate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => { setEditingTemplate(null); }}
        >
          <div
            className="bg-[#111111] rounded-xl border border-[#2a2a2a] w-full max-w-[680px] max-h-[720px] flex flex-col overflow-hidden"
            style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-2.5 bg-[#161616] border-b border-[#2a2a2a]">
              <span className="text-[14px] font-semibold text-white">Edit Template</span>
              <span className="flex-1" />
              <button onClick={() => { setEditingTemplate(null); }} className="text-[#71717A] hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Name row */}
            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[#2a2a2a]">
              <span className="text-[13px] text-[#71717A]">Name</span>
              <input
                type="text"
                value={editingTemplate.name}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                className="flex-1 bg-transparent text-[13px] text-white focus:outline-none"
                placeholder="Template name"
              />
            </div>

            {/* Subject row */}
            <div className="flex items-center gap-2.5 px-5 py-2.5 border-b border-[#2a2a2a]">
              <span className="text-[13px] text-[#71717A]">Subject</span>
              <input
                type="text"
                value={editingTemplate.subject}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                className="flex-1 bg-transparent text-[13px] text-white focus:outline-none"
                placeholder="Email subject"
              />
            </div>

            {/* Variables bar */}
            <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[#2a2a2a] bg-[#161616] overflow-x-auto">
              <span className="text-[11px] font-medium text-[#71717A] shrink-0 mr-1">Insert:</span>
              {DEFAULT_PLACEHOLDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setEditingTemplate({ ...editingTemplate, body: editingTemplate.body + p })}
                  className="shrink-0 text-[10px] font-mono font-medium text-[#A855F7] bg-[#A855F7]/10 border border-[#A855F7]/25 rounded px-2 py-0.5 hover:bg-[#A855F7]/20 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <textarea
                value={editingTemplate.body}
                onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                className="w-full h-full min-h-[280px] bg-transparent text-[13px] text-[#A1A1AA] p-5 focus:outline-none resize-none leading-[1.6]"
                placeholder="Write your template body here..."
              />
            </div>

            {/* Bottom bar */}
            <div className="flex items-center gap-2.5 px-5 py-2.5 bg-[#161616] border-t border-[#2a2a2a]">
              {!DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id) && (
                <button
                  onClick={() => {
                    handleDeleteTemplate(editingTemplate.id);
                    setEditingTemplate(null);
                  }}
                  className="p-1.5 rounded-lg hover:bg-[#252525] transition-colors"
                  title="Delete template"
                >
                  <svg className="w-4 h-4 text-[#ef4444]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              <span className="flex-1" />
              {!DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id) && !editingTemplate.isDefault && (
                <button
                  onClick={() => handleSetDefault(editingTemplate.id)}
                  className="text-[12px] text-[#71717A] hover:text-white px-3 py-1.5 rounded-lg hover:bg-[#252525] transition-colors"
                >
                  Set as Default
                </button>
              )}
              <button
                onClick={async () => {
                  if (DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id)) {
                    setEditingTemplate(null);
                    return;
                  }
                  if (editingTemplate.id === '__new__') {
                    // Create new template
                    if (!editingTemplate.name.trim() || !editingTemplate.body.trim()) {
                      setTemplateError('Template name and body are required');
                      return;
                    }
                    setIsSavingTemplate(true);
                    setTemplateError(null);
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
                    setIsSavingTemplate(false);
                  } else {
                    await handleUpdateTemplate();
                    if (!templateError) {
                      setEditingTemplate(null);
                    }
                  }
                }}
                disabled={isSavingTemplate || DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id)}
                className="text-[12px] font-semibold text-white bg-[#A855F7] rounded-full px-5 py-2 hover:bg-[#9333EA] transition-colors disabled:opacity-50"
              >
                {isSavingTemplate ? 'Saving...' : editingTemplate.id === '__new__' ? 'Create Template' : DEFAULT_TEMPLATES.some(dt => dt.id === editingTemplate.id) ? 'Close' : 'Save Template'}
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
