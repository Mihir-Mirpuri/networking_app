interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeConfig = {
  sm: { dim: 16, stroke: 2 },
  md: { dim: 24, stroke: 2.5 },
  lg: { dim: 32, stroke: 3 },
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const { dim, stroke } = sizeConfig[size];

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: dim, height: dim }}
      role="status"
      aria-label="Loading"
    >
      {/* Track ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{ border: `${stroke}px solid rgba(99, 102, 241, 0.15)` }}
      />
      {/* Gradient arc */}
      <div
        className="absolute inset-0 rounded-full animate-spin"
        style={{
          background: 'conic-gradient(transparent 25%, #4f46e5 100%)',
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
        }}
      />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

interface LoadingDotsProps {
  className?: string;
}

export function LoadingDots({ className = '' }: LoadingDotsProps) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} role="status" aria-label="Loading">
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce-dot" />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce-dot [animation-delay:0.15s]" />
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce-dot [animation-delay:0.3s]" />
      <span className="sr-only">Loading...</span>
    </span>
  );
}
