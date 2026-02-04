export default function Loading() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* Animated Logo */}
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-glow animate-pulse-soft">
          <span className="text-white font-bold text-xl">S</span>
        </div>
        {/* Spinner */}
        <div className="flex items-center gap-3 text-surface-500">
          <svg className="animate-spin h-5 w-5 text-primary-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm font-medium">Loading...</span>
        </div>
      </div>
    </div>
  );
}
