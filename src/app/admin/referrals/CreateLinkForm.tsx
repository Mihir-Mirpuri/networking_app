'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CreateLinkForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [type, setType] = useState<'AMBASSADOR' | 'QR_CODE'>('AMBASSADOR');
  const [label, setLabel] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          type,
          label: label.trim(),
          userId: userId.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create link');
        return;
      }

      setCode('');
      setLabel('');
      setUserId('');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-surface-200 p-5">
      <h3 className="font-semibold text-surface-900 mb-4">Create Referral Link</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="amb-jake"
              required
              className="input text-sm w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'AMBASSADOR' | 'QR_CODE')}
              className="input text-sm w-full"
            >
              <option value="AMBASSADOR">Ambassador</option>
              <option value="QR_CODE">QR Code</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Jake Smith"
              required
              className="input text-sm w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 mb-1">
              Ambassador User ID <span className="text-surface-400">(optional)</span>
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="cuid..."
              className="input text-sm w-full"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary text-sm"
        >
          {loading ? 'Creating...' : 'Create Link'}
        </button>
      </form>
    </div>
  );
}
