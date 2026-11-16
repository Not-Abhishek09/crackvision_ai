import { AlertTriangle, ArrowRight, Camera, Download, Eye, ShieldCheck } from 'lucide-react';
import { getReportDownloadUrl, getStorageUrl } from '../services/api';
import type { DashboardMetrics, InspectionRecord, NavSection } from '../types/inspection';

interface DashboardViewProps {
  metrics: DashboardMetrics | null;
  loading: boolean;
  onNavigate: (section: NavSection) => void;
  onViewReport: (record: InspectionRecord) => void;
  onInspectReportById: (id: string) => void;
}

export function DashboardView({
  metrics,
  loading,
  onNavigate,
  onViewReport,
  onInspectReportById,
}: DashboardViewProps) {
  if (loading && !metrics) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-24 rounded-[4px] border border-[#2A303C] bg-[#161A22] p-4 animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 rounded-[4px] border border-[#2A303C] bg-[#161A22] animate-pulse" />
      </div>
    );
  }

  const totalInspections = metrics?.total_inspections ?? 0;

  if (totalInspections === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Inspections" value="0" subtext="Stored SQLite records" />
          <KpiCard label="Total Cracks Detected" value="0" subtext="Across structural scans" />
          <KpiCard label="Total Workers Detected" value="0" subtext="Across safety scans" />
          <KpiCard label="Helmet Compliance" value="N/A" subtext="Awaiting worker detections" />
        </div>

        <div className="flex flex-col items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#161A22] px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[4px] border border-[#3A4252] bg-[#1E232D] text-[#FACC15]">
            <Camera className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-[#F3F4F6]">
            No Inspection Records Stored Yet
          </h2>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#9CA3AF]">
            Dashboard metrics, structural severity breakdowns, and worker safety compliance rates
            are computed directly from completed inspections saved in SQLite.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('live')}
              className="inline-flex items-center gap-2 rounded-[4px] bg-[#FACC15] px-4 py-2 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308]"
            >
              Start Live Inspection
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('cracks')}
              className="inline-flex items-center gap-2 rounded-[4px] border border-[#2A303C] bg-[#1E232D] px-4 py-2 text-xs font-medium text-[#F3F4F6] hover:bg-[#262C38]"
            >
              Crack Detection
            </button>
          </div>
        </div>
      </div>
    );
  }

  const complianceText =
    metrics?.overall_helmet_compliance_percent !== null &&
    metrics?.overall_helmet_compliance_percent !== undefined
      ? `${metrics.overall_helmet_compliance_percent.toFixed(1)}%`
      : 'N/A';

  const sev = metrics!.severity_breakdown;
  const sevTotal = Math.max(1, sev.high + sev.medium + sev.low + sev.none);

  return (
    <div className="space-y-4">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Inspections"
          value={String(metrics!.total_inspections)}
          subtext="Persisted inspection runs"
        />
        <KpiCard
          label="Total Cracks Detected"
          value={String(metrics!.total_cracks_detected)}
          subtext={`High: ${sev.high} · Med: ${sev.medium} · Low: ${sev.low}`}
          accent="yellow"
        />
        <KpiCard
          label="Total Workers Detected"
          value={String(metrics!.total_workers_detected)}
          subtext={`${metrics!.total_helmet_violations} violation(s) · ${metrics!.total_uncertain_detections} uncertain`}
        />
        <KpiCard
          label="Helmet Compliance"
          value={complianceText}
          subtext={`${metrics!.total_workers_with_helmet} / ${metrics!.total_workers_detected} compliant`}
          accent={
            metrics!.overall_helmet_compliance_percent === null
              ? 'default'
              : metrics!.overall_helmet_compliance_percent >= 90
                ? 'green'
                : 'red'
          }
        />
      </div>

      {/* Middle Split: Structural Overview + Recent Safety Violations */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Structural Inspection Overview */}
        <section className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-4 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[#2A303C] pb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F3F4F6]">
              Structural Inspection Overview
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('cracks')}
              className="text-xs font-medium text-[#FACC15] hover:underline"
            >
              Open Scanner
            </button>
          </div>

          <div className="mt-4 space-y-3 text-xs">
            {(
              [
                ['High Severity (Est.)', sev.high, 'bg-[#DC2626]', 'text-[#FCA5A5]'],
                ['Medium Severity (Est.)', sev.medium, 'bg-[#EA580C]', 'text-[#FDBA74]'],
                ['Low Severity (Est.)', sev.low, 'bg-[#FACC15]', 'text-[#FDE047]'],
                ['No Cracks Detected', sev.none, 'bg-[#16A34A]', 'text-[#86EFAC]'],
              ] as const
            ).map(([label, count, barColor, textColor]) => {
              const pct = Math.round((count / sevTotal) * 100);
              return (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-sans text-[#D1D5DB]">{label}</span>
                    <span className={textColor}>
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-[2px] bg-[#0E1116]">
                    <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] text-[#6B7280]">
            Severity classifications reflect AI-generated visual estimates across recorded structural scans.
          </p>
        </section>

        {/* Recent Safety Violations */}
        <section className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-4 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[#2A303C] pb-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F3F4F6]">
              Recent Safety Violations &amp; Unverified Cases
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('helmets')}
              className="text-xs font-medium text-[#FACC15] hover:underline"
            >
              Helmet Monitor
            </button>
          </div>

          {metrics!.recent_violations.length === 0 ? (
            <div className="flex items-center gap-3 py-10 text-xs text-[#9CA3AF]">
              <ShieldCheck className="h-5 w-5 text-[#16A34A]" />
              <span>No safety helmet violations or uncertain worker detections recorded.</span>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-[#2A303C]">
              {metrics!.recent_violations.map((v) => (
                <div
                  key={v.inspection_id}
                  className="flex items-center justify-between gap-3 py-2.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={getStorageUrl(v.annotated_image_key)}
                      alt={`Snapshot ${v.inspection_id}`}
                      className="h-10 w-14 shrink-0 rounded-[3px] border border-[#2A303C] bg-[#0E1116] object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-mono font-medium text-[#F3F4F6]">
                        {v.inspection_id} · {v.zone_label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
                        {new Date(v.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 font-mono">
                    {v.workers_without_helmet > 0 && (
                      <span className="inline-flex items-center gap-1 text-[#DC2626]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {v.workers_without_helmet} no helmet
                      </span>
                    )}
                    {v.uncertain_detections > 0 && (
                      <span className="text-[#EA580C]">{v.uncertain_detections} uncertain</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onInspectReportById(v.inspection_id)}
                      className="rounded-[4px] border border-[#2A303C] bg-[#1E232D] px-2.5 py-1 text-[11px] font-sans font-medium text-[#F3F4F6] hover:bg-[#262C38]"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Inspection Activity */}
      <section className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-4">
        <div className="flex items-center justify-between border-b border-[#2A303C] pb-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F3F4F6]">
            Recent Inspection Activity
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="text-xs font-medium text-[#FACC15] hover:underline"
          >
            View All Reports
          </button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#2A303C] text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <th className="py-2 pr-3">Inspection ID</th>
                <th className="py-2 px-3">Date &amp; Time</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3 text-right">Cracks</th>
                <th className="py-2 px-3 text-right">Workers</th>
                <th className="py-2 px-3 text-right">Compliance</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 pl-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A303C]">
              {metrics!.recent_inspections.map((rec) => (
                <tr key={rec.id} className="hover:bg-[#1B202A]">
                  <td className="py-2.5 pr-3 font-mono font-medium text-[#F3F4F6] whitespace-nowrap">
                    {rec.id}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[#9CA3AF] whitespace-nowrap">
                    {new Date(rec.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono uppercase text-[#D1D5DB] whitespace-nowrap">
                    {rec.mode}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#FACC15]">
                    {rec.crack_results ? rec.crack_results.total_cracks : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#F3F4F6]">
                    {rec.helmet_results ? rec.helmet_results.total_workers : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-[#D1D5DB]">
                    {rec.helmet_results && rec.helmet_results.helmet_compliance_percent !== null
                      ? `${rec.helmet_results.helmet_compliance_percent.toFixed(1)}%`
                      : '-'}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`font-mono text-[11px] font-medium ${
                        rec.status === 'Nominal'
                          ? 'text-[#16A34A]'
                          : rec.status === 'Attention Required'
                            ? 'text-[#EA580C]'
                            : 'text-[#DC2626]'
                      }`}
                    >
                      {rec.status}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onViewReport(rec)}
                        className="inline-flex items-center gap-1 rounded-[3px] border border-[#2A303C] bg-[#1E232D] px-2 py-1 text-[11px] text-[#F3F4F6] hover:bg-[#262C38]"
                      >
                        <Eye className="h-3 w-3" />
                        View
                      </button>
                      <a
                        href={getReportDownloadUrl(rec.id)}
                        download={`${rec.id}_inspection_report.pdf`}
                        className="inline-flex items-center gap-1 rounded-[3px] border border-[#2A303C] bg-[#11141A] px-2 py-1 text-[11px] text-[#FACC15] hover:border-[#FACC15]"
                      >
                        <Download className="h-3 w-3" />
                        PDF
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtext,
  accent = 'default',
}: {
  label: string;
  value: string;
  subtext: string;
  accent?: 'default' | 'yellow' | 'green' | 'red';
}) {
  const valueColor =
    accent === 'yellow'
      ? 'text-[#FACC15]'
      : accent === 'green'
        ? 'text-[#16A34A]'
        : accent === 'red'
          ? 'text-[#DC2626]'
          : 'text-[#F3F4F6]';

  return (
    <div className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">{label}</p>
      <p className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${valueColor}`}>
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] text-[#6B7280]">{subtext}</p>
    </div>
  );
}
