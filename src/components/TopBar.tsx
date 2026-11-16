import { Menu, RefreshCw, User } from 'lucide-react';
import type {
  CameraConnectionState,
  HealthStatus,
  NavSection,
  SiteSettings,
} from '../types/inspection';

interface TopBarProps {
  activeSection: NavSection;
  health: HealthStatus | null;
  healthLoading: boolean;
  cameraState: CameraConnectionState;
  settings: SiteSettings | null;
  onRefreshHealth: () => void;
  onOpenMobileMenu: () => void;
}

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  live: 'Live Inspection',
  cracks: 'Crack Detection',
  helmets: 'Helmet Detection',
  reports: 'Inspection Reports',
  settings: 'Settings',
};

export function TopBar({
  activeSection,
  health,
  healthLoading,
  cameraState,
  settings,
  onRefreshHealth,
  onOpenMobileMenu,
}: TopBarProps) {
  const backendOk = health?.status === 'ok';
  const modelOk = Boolean(health?.ai_model?.available);
  const pythonActive = Boolean(settings?.python_backend_url && health?.python_backend?.reachable);

  const cameraLabel =
    cameraState === 'active'
      ? 'Active'
      : cameraState === 'starting'
        ? 'Connecting'
        : cameraState === 'denied'
          ? 'Blocked'
          : cameraState === 'error'
            ? 'Error'
            : 'Standby';

  const cameraColor =
    cameraState === 'active'
      ? 'text-[#16A34A]'
      : cameraState === 'denied' || cameraState === 'error'
        ? 'text-[#DC2626]'
        : 'text-[#9CA3AF]';

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-[#2A303C] bg-[#13161D] px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#161A22] text-[#D1D5DB] hover:bg-[#1E232D] lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        <h1 className="truncate text-base font-semibold tracking-tight text-[#F3F4F6] whitespace-nowrap">
          {SECTION_TITLES[activeSection]}
        </h1>
      </div>

      <div className="flex items-center gap-5">
        <div className="hidden items-center gap-4 border-r border-[#2A303C] pr-4 text-xs md:flex">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[#6B7280]">Backend:</span>
            <span className={`font-mono font-medium ${backendOk ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
              {healthLoading ? 'Checking' : backendOk ? 'Connected' : 'Offline'}
            </span>
          </div>

          <span className="text-[#2A303C]" aria-hidden="true">|</span>

          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[#6B7280]">AI Model:</span>
            <span
              className={`font-mono font-medium ${
                pythonActive || modelOk ? 'text-[#16A34A]' : 'text-[#EA580C]'
              }`}
            >
              {pythonActive
                ? 'FastAPI YOLO'
                : modelOk
                  ? health?.ai_model.model
                  : health?.ai_model.key_configured
                    ? 'Unavailable'
                    : 'No API Key'}
            </span>
          </div>

          <span className="text-[#2A303C]" aria-hidden="true">|</span>

          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[#6B7280]">Camera:</span>
            <span className={`font-mono font-medium ${cameraColor}`}>{cameraLabel}</span>
          </div>

          <button
            type="button"
            onClick={onRefreshHealth}
            title="Refresh system health"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#161A22] text-[#9CA3AF] hover:border-[#3A4252] hover:text-[#F3F4F6]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#1E232D] text-[#FACC15]">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="hidden text-right sm:block">
            <p className="max-w-[160px] truncate text-xs font-medium text-[#F3F4F6]">
              {settings?.inspector_name || 'Site Safety Engineer'}
            </p>
            <p className="max-w-[160px] truncate text-[11px] text-[#6B7280]">
              {settings?.site_name || 'North Sector Site'}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
