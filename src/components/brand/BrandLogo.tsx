import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

type BrandLogoSize = 'sidebar' | 'setup';

const sizeClasses: Record<BrandLogoSize, string> = {
  sidebar: 'h-7 w-7 rounded-lg',
  setup: 'h-16 w-16 rounded-[18px]',
};

export function BrandLogo({
  alt = 'Verse',
  size = 'sidebar',
  className,
}: {
  alt?: string;
  size?: BrandLogoSize;
  className?: string;
}) {
  return (
    <img
      src={logo}
      data-testid="brand-logo"
      alt={alt}
      className={cn('block shrink-0 object-contain', sizeClasses[size], className)}
    />
  );
}
