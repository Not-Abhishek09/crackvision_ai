import {
  Camera,
  FileText,
  HardHat,
  LayoutDashboard,
  ScanLine,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import type { NavSection } from '../types/inspection';

interface SidebarProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'live', label: 'Live Inspection', icon: Camera },
  { id: 'cracks', label: 'Crack Detection', icon: ScanLine },
  { id: 'helmets', label: 'Helmet Detection', icon: HardHat },
  { id: 'reports', label: 'Inspection Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeSection,
  onSelect,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-[#2A303C] bg-[#13161D] transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-[#2A303C] px-4">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-[#FACC15] text-[#0E1116]">
            <ShieldAlert className="h-4 w-4 stroke-[2.2]" />
          </div>
          <span className="truncate text-sm font-bold tracking-tight text-[#F3F4F6] whitespace-nowrap">
            CONSTRUCTION VISION
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  onCloseMobile();
                }}
                className={`flex w-full items-center gap-3 rounded-[4px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'border border-[#3A4252] bg-[#1E232D] text-[#FACC15]'
                    : 'border border-transparent text-[#9CA3AF] hover:bg-[#1A1E27] hover:text-[#F3F4F6]'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-[#FACC15]' : 'text-[#6B7280]'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[#2A303C] px-4 py-3 text-[11px] text-[#9CA3AF]">
          <p className="font-medium text-[#D1D5DB]">AI Screening Workspace</p>
          <p className="mt-0.5 leading-relaxed text-[#6B7280]">
            Preliminary visual screening only. Requires engineer verification.
          </p>
        </div>
      </aside>
    </>
  );
}
