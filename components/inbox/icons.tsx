/**
 * Small stroke icons for the inbox. 1.75px strokes at 16px, currentColor,
 * decorative by default (aria-hidden); give the parent a label instead.
 */

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PhotoIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.75" />
    <path d="m21 16-5-5-9 9" />
  </Icon>
);

export const VideoIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="m16 10 5-3v10l-5-3" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const FileIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Icon>
);

export const CardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 13h18M8 17h8" />
  </Icon>
);

export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Icon>
);

export const ReelIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M3 8h18M8 3l3 5M14 3l3 5" />
    <path d="m10 12 4.5 2.5L10 17z" />
  </Icon>
);

export const StoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2.2" />
    <circle cx="12" cy="12" r="4.5" />
  </Icon>
);

export const StickerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-9-9h4l5 5z" />
    <path d="M8.5 14.5a4 4 0 0 0 7 0M9 10h.01M15 10h.01" />
  </Icon>
);

export const TimerIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M10 2h4" />
  </Icon>
);

export const BanIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </Icon>
);

export const TapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10l4.2.8a2 2 0 0 1 1.6 2.3l-.8 4.4a3 3 0 0 1-3 2.5h-2.6a3 3 0 0 1-2.4-1.2L6 15.5a1.5 1.5 0 0 1 2.2-2z" />
  </Icon>
);

export const PlayIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5" />
  </Icon>
);

export const PauseIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1.25" />
    <rect x="14" y="5" width="4" height="14" rx="1.25" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Icon>
);

export const ProfileIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export const FlowIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v3a4 4 0 0 0 4 4h5.5" />
  </Icon>
);

export const ReplyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6v5" />
  </Icon>
);
