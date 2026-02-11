import { LoadingDots } from '@/components/search/LoadingSpinner';

export default function Loading() {
  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        {/* Logo with ripple rings */}
        <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
          {/* Ripple rings emanating from the logo */}
          <div className="absolute w-14 h-14 rounded-full border-2 border-primary-400/40 animate-ripple" />
          <div className="absolute w-14 h-14 rounded-full border-[1.5px] border-primary-300/30 animate-ripple [animation-delay:0.7s]" />
          <div className="absolute w-14 h-14 rounded-full border border-primary-200/20 animate-ripple [animation-delay:1.4s]" />
          {/* Logo */}
          <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-glow">
            <span className="text-white font-bold text-2xl">S</span>
          </div>
        </div>
        {/* Loading text with animated dots */}
        <div className="flex items-center gap-1 text-surface-400">
          <span className="text-sm font-medium">Loading</span>
          <LoadingDots />
        </div>
      </div>
    </div>
  );
}
