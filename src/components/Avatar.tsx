/** Reusable avatar — shows photo if available, otherwise gradient + initial. */
export function Avatar({ name, photoURL, size = 'md' }: {
  name: string;
  photoURL?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  const cls = `${sizeClasses[size]} rounded-full flex-shrink-0`;

  if (photoURL) {
    return <img src={photoURL} alt="" className={`${cls} object-cover`} />;
  }

  return (
    <div className={`${cls} bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
