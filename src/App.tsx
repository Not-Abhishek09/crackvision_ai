import { useCallback, useEffect, useState } from 'react';
import {
  deleteInspection,
  fetchDashboard,
  fetchHealth,
  fetchInspectionById,
  fetchInspections,
  fetchSamples,
  fetchSettings,
} from './services/api';
import type {
  CameraConnectionState,
  DashboardMetrics,
  HealthStatus,
  InspectionRecord,
  NavSection,
  SampleImageItem,
  SiteSettings,
} from './types/inspection';
import { DashboardView } from './components/DashboardView';
import { InspectionWorkspace } from './components/InspectionWorkspace';
import { ReportDetailModal } from './components/ReportDetailModal';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('live');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [cameraState, setCameraState] = useState<CameraConnectionState>('inactive');

  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [samples, setSamples] = useState<SampleImageItem[]>([]);

  const [dashboard, setDashboard] = useState<DashboardMetrics | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [reports, setReports] = useState<InspectionRecord[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const [selectedReport, setSelectedReport] = useState<InspectionRecord | null>(null);

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await fetchHealth();
      setHealth(h);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const refreshDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const data = await fetchDashboard();
      setDashboard(data);
    } catch {
      // keep previous state on transient failure
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const refreshReports = useCallback(async (search = '', mode = 'all', status = 'all') => {
    setReportsLoading(true);
    try {
      const res = await fetchInspections({ search, mode, status });
      setReports(res.items);
    } catch {
      // handled gracefully
    } finally {
      setReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void fetchSettings().then(setSettings).catch(() => undefined);
    void fetchSamples().then(setSamples).catch(() => undefined);
    void refreshDashboard();
    void refreshReports();
  }, [refreshDashboard, refreshHealth, refreshReports]);

  useEffect(() => {
    if (activeSection === 'dashboard') {
      void refreshDashboard();
    } else if (activeSection === 'reports') {
      void refreshReports();
    }
  }, [activeSection, refreshDashboard, refreshReports]);

  const handleInspectionCompleted = useCallback(() => {
    void refreshDashboard();
    void refreshReports();
  }, [refreshDashboard, refreshReports]);

  const handleInspectReportById = useCallback(async (id: string) => {
    try {
      const rec = await fetchInspectionById(id);
      setSelectedReport(rec);
    } catch {
      // ignore
    }
  }, []);

  const handleDeleteReport = useCallback(
    async (id: string) => {
      await deleteInspection(id);
      if (selectedReport?.id === id) {
        setSelectedReport(null);
      }
      await Promise.all([refreshReports(), refreshDashboard()]);
    },
    [refreshDashboard, refreshReports, selectedReport?.id],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0E1116] text-[#F3F4F6]">
      <Sidebar
        activeSection={activeSection}
        onSelect={setActiveSection}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          activeSection={activeSection}
          health={health}
          healthLoading={healthLoading}
          cameraState={cameraState}
          settings={settings}
          onRefreshHealth={() => void refreshHealth()}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
          {activeSection === 'dashboard' && (
            <DashboardView
              metrics={dashboard}
              loading={dashboardLoading}
              onNavigate={setActiveSection}
              onViewReport={setSelectedReport}
              onInspectReportById={(id) => void handleInspectReportById(id)}
            />
          )}

          {activeSection === 'live' && (
            <InspectionWorkspace
              key="workspace-live"
              defaultMode="combined"
              settings={settings}
              samples={samples}
              cameraState={cameraState}
              onCameraStateChange={setCameraState}
              onInspectionCompleted={handleInspectionCompleted}
              onViewReport={setSelectedReport}
            />
          )}

          {activeSection === 'cracks' && (
            <InspectionWorkspace
              key="workspace-cracks"
              defaultMode="cracks"
              lockMode
              settings={settings}
              samples={samples}
              cameraState={cameraState}
              onCameraStateChange={setCameraState}
              onInspectionCompleted={handleInspectionCompleted}
              onViewReport={setSelectedReport}
            />
          )}

          {activeSection === 'helmets' && (
            <InspectionWorkspace
              key="workspace-helmets"
              defaultMode="helmets"
              lockMode
              settings={settings}
              samples={samples}
              cameraState={cameraState}
              onCameraStateChange={setCameraState}
              onInspectionCompleted={handleInspectionCompleted}
              onViewReport={setSelectedReport}
            />
          )}

          {activeSection === 'reports' && (
            <ReportsView
              records={reports}
              loading={reportsLoading}
              onSearchChange={(s, m, st) => void refreshReports(s, m, st)}
              onViewReport={setSelectedReport}
              onDeleteReport={(id) => void handleDeleteReport(id)}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              settings={settings}
              health={health}
              onSettingsSaved={(updated) => {
                setSettings(updated);
                void refreshHealth();
              }}
            />
          )}
        </main>
      </div>

      <ReportDetailModal
        record={selectedReport}
        onClose={() => setSelectedReport(null)}
      />
    </div>
  );
}
