interface SkeletonProps {
  /** Size it with width/height utilities, e.g. `h-24 w-full`. */
  className?: string;
}

/** Pulsing placeholder block. */
export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-control bg-surface-2 ${className}`} aria-hidden="true" />;
}
