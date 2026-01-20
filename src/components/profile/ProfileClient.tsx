'use client';

import { useState, useEffect } from 'react';
import { signOut } from 'next-auth/react';
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

export function ProfileClient({ userEmail, userName, userImage }: ProfileClientProps) {
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
  const [isCreating, setIsCreating] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', subject: '', body: '' });
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Load profile and templates on mount
  useEffect(() => {
    loadProfile();
    loadTemplates();
  }, []);

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

    const result = await createTemplateAction(newTemplate);
    if (result.success) {
      setTemplates([...templates, result.template]);
      setNewTemplate({ name: '', subject: '', body: '' });
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Classification
            </label>
            <input
              type="text"
              value={profile.classification || ''}
              onChange={(e) => setProfile({ ...profile, classification: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="e.g., Junior, Senior"
            />
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              University
            </label>
            <input
              type="text"
              value={profile.university || ''}
              onChange={(e) => setProfile({ ...profile, university: e.target.value })}
              disabled={isLoadingProfile}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              placeholder="e.g., Harvard University"
            />
          </div>

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

      {/* My Templates Section */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">My Templates</h2>
          {!isCreating && (
            <button
              onClick={() => setIsCreating(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + Add Template
            </button>
          )}
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Available placeholders: {'{first_name}'}, {'{user_name}'}, {'{company}'}, {'{university}'}, {'{classification}'}, {'{major}'}, {'{career}'}, {'{role}'}
        </p>

        {templateError && (
          <div className="mb-4 px-4 py-2 bg-red-100 text-red-800 rounded">
            {templateError}
          </div>
        )}

        {/* Create New Template Form */}
        {isCreating && (
          <div className="mb-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
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
                placeholder="Email subject"
              />
              <textarea
                value={newTemplate.body}
                onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Email body"
              />
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
                    setNewTemplate({ name: '', subject: '', body: '' });
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Templates List */}
        {isLoadingTemplates ? (
          <div className="text-center py-8 text-gray-500">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">Default Template</span>
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                  Default
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              <strong>Subject:</strong> {DEFAULT_TEMPLATE.subject}
            </p>
            <p className="text-sm text-gray-500 whitespace-pre-wrap line-clamp-3">
              {DEFAULT_TEMPLATE.body}
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Create your first template to customize your outreach emails.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {templates.map((template) => (
              <div key={template.id} className="border rounded-lg p-4">
                {editingTemplate?.id === template.id ? (
                  // Edit Mode
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Template name"
                    />
                    <input
                      type="text"
                      value={editingTemplate.subject}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, subject: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Email subject"
                    />
                    <textarea
                      value={editingTemplate.body}
                      onChange={(e) =>
                        setEditingTemplate({ ...editingTemplate, body: e.target.value })
                      }
                      rows={6}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleUpdateTemplate}
                        disabled={isSavingTemplate}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isSavingTemplate ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingTemplate(null)}
                        className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  // View Mode
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{template.name}</span>
                        {template.isDefault && (
                          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!template.isDefault && (
                          <button
                            onClick={() => handleSetDefault(template.id)}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Set as Default
                          </button>
                        )}
                        <button
                          onClick={() => setEditingTemplate(template)}
                          className="text-sm text-gray-600 hover:text-gray-800"
                        >
                          Edit
                        </button>
                        {!template.isDefault && (
                          <button
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="text-sm text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>Subject:</strong> {template.subject}
                    </p>
                    <p className="text-sm text-gray-500 whitespace-pre-wrap line-clamp-3">
                      {template.body}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
