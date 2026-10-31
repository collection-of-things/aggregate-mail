// Outline icons for the editor tool bar, 16px on a 16-unit grid. Swap for
// drawn assets when they exist.
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const PaperclipIcon = () => <Icon><path d="M13 7.5 8 12.5a3.2 3.2 0 0 1-4.5-4.5l5.3-5.3a2.1 2.1 0 0 1 3 3L6.5 11a1.1 1.1 0 0 1-1.5-1.5L10 4.5" /></Icon>;
export const LinkIcon = () => <Icon><path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" /><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" /></Icon>;
export const BulletsIcon = () => <Icon><path d="M6 4h7.5M6 8h7.5M6 12h7.5" /><circle cx="3" cy="4" r=".6" fill="currentColor" /><circle cx="3" cy="8" r=".6" fill="currentColor" /><circle cx="3" cy="12" r=".6" fill="currentColor" /></Icon>;
export const NumbersIcon = () => <Icon><path d="M6.5 4h7M6.5 8h7M6.5 12h7" /><path d="M2.5 3.2 3.4 2.6v3" /><path d="M2.4 7.4a.9.9 0 0 1 1.6.5c0 .7-1.6 1.4-1.6 2.1h1.7" /><path d="M2.4 11.6h1.5l-.8 1 .5.1a.7.7 0 1 1-1 .9" /></Icon>;
export const QuoteIcon = () => <Icon><path d="M3 3.5v9" /><path d="M6.5 5h7M6.5 8h7M6.5 11h4.5" /></Icon>;
export const SignatureIcon = () => <Icon><path d="M2 12.5c1.5 0 2.2-6.5 3.8-6.5 1.5 0 .2 4.5 1.6 4.5 1 0 1.4-2 2.4-2 .8 0 .8 1.4 1.6 1.4.6 0 1.1-.4 1.6-.9" /><path d="M2 14.5h12" /></Icon>;
export const TrashIcon = () => <Icon><path d="M2.8 4.2h10.4M6.4 4.2V2.8h3.2v1.4M4 4.2l.6 8.8c0 .4.4.8.8.8h5.2c.4 0 .8-.4.8-.8l.6-8.8" /><path d="M6.7 7v4.2M9.3 7v4.2" /></Icon>;
export const PersonIcon = () => <Icon><circle cx="8" cy="5.6" r="2.6" /><path d="M3.2 13.6c.6-2.4 2.5-3.8 4.8-3.8s4.2 1.4 4.8 3.8" /></Icon>;
export const CollapseIcon = () => <Icon><path d="M8 4 4 8l4 4M12.5 4l-4 4 4 4" /></Icon>;
export const CloseIcon = () => <Icon><path d="m4 4 8 8M12 4l-8 8" /></Icon>;
export const TodayIcon = () => <Icon><circle cx="8" cy="8" r="5.8" /><path d="m5.6 8.1 1.7 1.7 3.2-3.4" /></Icon>;
export const CalendarIcon = () => <Icon><rect x="2.3" y="3.2" width="11.4" height="10.3" rx="2" /><path d="M2.3 6.4h11.4M5.4 1.9v2.4M10.6 1.9v2.4" /></Icon>;
export const ProjectsIcon = () => <Icon><path d="M2.3 5V3.8c0-.6.5-1 1-1h3l1.4 1.6h5c.6 0 1 .4 1 1v6.9c0 .6-.4 1-1 1H3.3c-.5 0-1-.4-1-1V5Z" /><path d="M2.3 6.6h11.4" /></Icon>;
export const AgentIcon = () => <Icon><path d="M8 2.2c.4 2.6 1.6 3.8 4.2 4.2-2.6.4-3.8 1.6-4.2 4.2-.4-2.6-1.6-3.8-4.2-4.2 2.6-.4 3.8-1.6 4.2-4.2Z" /><path d="M12.4 10.6c.2 1.1.7 1.6 1.8 1.8-1.1.2-1.6.7-1.8 1.8-.2-1.1-.7-1.6-1.8-1.8 1.1-.2 1.6-.7 1.8-1.8Z" /></Icon>;
export const InboxIcon = () => <Icon><path d="M2.3 9.2 3.9 3.8c.1-.5.6-.8 1-.8h6.2c.4 0 .9.3 1 .8l1.6 5.4v3c0 .6-.4 1-1 1H3.3c-.6 0-1-.4-1-1v-3Z" /><path d="M2.3 9.2h3l.9 1.6h3.6l.9-1.6h3" /></Icon>;
export const SnoozeIcon = () => <Icon><circle cx="8" cy="8.6" r="5" /><path d="M8 6.1v2.7l1.7 1.1M2.7 3.4l1.8-1.3M13.3 3.4l-1.8-1.3" /></Icon>;
export const ArchiveIcon = () => <Icon><rect x="2.2" y="2.8" width="11.6" height="3.2" rx="1" /><path d="M3.2 6v6.2c0 .6.4 1 1 1h7.6c.6 0 1-.4 1-1V6M6.4 8.6h3.2" /></Icon>;
export const SentIcon = () => <Icon><path d="M13.8 2.2 7 9M13.8 2.2 9.6 13.6 7 9 2.4 6.4l11.4-4.2Z" /></Icon>;
export const AllMailIcon = () => <Icon><path d="m2.4 5.4 5.6-3 5.6 3-5.6 3-5.6-3Z" /><path d="m2.4 8.2 5.6 3 5.6-3M2.4 11 8 14l5.6-3" /></Icon>;
export const PlusIcon = () => <Icon><path d="M8 3v10M3 8h10" /></Icon>;
export const ReplyIcon = () => <Icon><path d="M6.4 3.6 2.6 7.3l3.8 3.7" /><path d="M2.8 7.3h6.4c2.4 0 4.2 1.8 4.2 4.2v.9" /></Icon>;
export const PinIcon = () => <Icon><path d="M9.9 2.2 13.8 6.1l-1.6.6-2.6 2.6-.3 2.5-1.1 1.1-5-5 1.1-1.1 2.5-.3 2.6-2.6.5-1.7Z" /><path d="m5.1 10.9-2.7 2.7" /></Icon>;
export const TrackIcon = () => <Icon><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2.4" /><path d="m5.6 8.1 1.6 1.6 3.2-3.3" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M8 2.6v7.6M4.9 7.2 8 10.3l3.1-3.1M3 13.2h10" /></Icon>;
export const RetryIcon = () => <Icon><path d="M13 8a5 5 0 1 1-1.5-3.6M13.2 2.8v2.6h-2.6" /></Icon>;
export const SearchIcon = () => <Icon><circle cx="7" cy="7" r="4.3" /><path d="m10.2 10.2 3.3 3.3" /></Icon>;
export const GridIcon = () => <Icon><rect x="2.6" y="2.6" width="4.4" height="4.4" rx="1.2" /><rect x="9" y="2.6" width="4.4" height="4.4" rx="1.2" /><rect x="2.6" y="9" width="4.4" height="4.4" rx="1.2" /><rect x="9" y="9" width="4.4" height="4.4" rx="1.2" /></Icon>;
