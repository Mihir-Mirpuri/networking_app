'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { ProfileSidebar, ProfileTab } from './ProfileSidebar';
import { ProfileClient } from './ProfileClient';
import { NewHeader } from '@/components/layout/NewHeader';
import { getProfileAction } from '@/app/actions/profile';
import { getSubscriptionStatus } from '@/app/actions/subscription';

interface ProfileLayoutProps {
  userEmail: string;
  userName: string;
  userImage: string;
}

export function ProfileLayout({ userEmail, userName, userImage }: ProfileLayoutProps) {
  const { status } = useSession();
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [university, setUniversity] = useState<string | null>(null);
  const [classification, setClassification] = useState<string | null>(null);
  const [major, setMajor] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      getProfileAction().then((result) => {
        if (result.success) {
          setUniversity(result.profile.university);
          setClassification(result.profile.classification);
          setMajor(result.profile.major);
        }
      });
      getSubscriptionStatus().then((result) => {
        setIsSubscribed(result.isSubscribed ?? false);
      });
    }
  }, [status]);

  return (
    <div className="flex h-screen bg-[#212121] overflow-hidden">
      {/* Sidebar spans full height */}
      <ProfileSidebar
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        university={university}
        classification={classification}
        major={major}
        isSubscribed={isSubscribed}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      {/* Right side: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <NewHeader />
        <div className="flex-1 overflow-y-auto">
          <ProfileClient
            userEmail={userEmail}
            userName={userName}
            userImage={userImage}
            activeTab={activeTab}
          />
        </div>
      </div>
    </div>
  );
}
