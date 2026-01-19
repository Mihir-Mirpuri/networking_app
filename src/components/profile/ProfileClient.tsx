'use client';

import { signOut } from 'next-auth/react';

interface ProfileClientProps {
  userEmail: string;
  userName: string;
  userImage: string;
}

export function ProfileClient({ userEmail, userName, userImage }: ProfileClientProps) {
  const handleSignOut = () => {
    signOut({ callbackUrl: '/auth/signin' });
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profile</h1>

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
            {userName && (
              <h2 className="text-lg font-semibold text-gray-900">{userName}</h2>
            )}
            <p className="text-gray-600">{userEmail}</p>
          </div>
        </div>

        <div className="border-t pt-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Account</h3>
          <div className="bg-gray-50 rounded-md p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-600">{userEmail}</p>
              </div>
              <span className="text-xs px-2 py-1 bg-green-100 text-green-800 rounded-full">
                Google
              </span>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
