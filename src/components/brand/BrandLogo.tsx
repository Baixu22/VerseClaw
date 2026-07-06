import { cn } from '@/lib/utils';
import { useResolvedTheme } from '@/lib/theme';
import logoLight1 from '@/assets/brand/logo-light-1.png';
import logoLight2 from '@/assets/brand/logo-light-2.png';
import logoLight3 from '@/assets/brand/logo-light-3.png';
import logoDark1 from '@/assets/brand/logo-dark-1.png';

const LIGHT_LOGOS = [logoLight1, logoLight2, logoLight3] as const;
const DARK_LOGOS = [logoDark1] as const;

const lightLogoIndex = Math.floor(Math.random() * LIGHT_LOGOS.length);
const darkLogoIndex = Math.floor(Math.random() * DARK_LOGOS.length);

type BrandLogoSize = 'sidebar' | 'setup';

const sizeClasses: Record<BrandLogoSize, string> = {
  sidebar: 'h-7 w-[35px] rounded-lg',
  setup: 'h-16 w-20 rounded-[18px]',
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
  const resolvedTheme = useResolvedTheme();
  const src = resolvedTheme === 'dark'
    ? DARK_LOGOS[darkLogoIndex]
    : LIGHT_LOGOS[lightLogoIndex];

  return (
    <img
      src={src}
      alt={alt}
      className={cn('block shrink-0 object-contain', sizeClasses[size], className)}
    />
  );
}
