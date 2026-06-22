import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Renders a reliable, offline thumbnail. When a real image URL exists it is
 * used; otherwise a tasteful gradient is synthesised from the artwork's
 * dominant colors so no cell ever looks empty.
 */
export function ArtworkThumbnail({
  colors,
  src,
  alt,
  className,
  rounded = 'md',
  showIcon = true,
}: {
  colors: string[];
  src?: string | null;
  alt?: string;
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl';
  showIcon?: boolean;
}) {
  const radius = {
    sm: 'rounded',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
  }[rounded];

  const [c1, c2, c3] = [
    colors[0] ?? '#3a3a3a',
    colors[1] ?? colors[0] ?? '#555',
    colors[2] ?? colors[1] ?? '#888',
  ];

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden ring-1 ring-black/5 dark:ring-white/5',
        radius,
        className,
      )}
      style={
        src
          ? undefined
          : {
              backgroundImage: `radial-gradient(120% 120% at 25% 15%, ${c3} 0%, ${c2} 45%, ${c1} 100%)`,
            }
      }
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt ?? ''} className="h-full w-full object-cover" />
      ) : (
        <>
          {/* canvas texture + soft vignette */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.12),transparent_40%,rgba(0,0,0,0.18))]" />
          {showIcon && (
            <ImageIcon className="relative size-1/4 max-h-6 max-w-6 text-white/35" />
          )}
        </>
      )}
    </div>
  );
}
