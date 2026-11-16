import { useState } from 'react';
import { Download, Eye, Search, Trash2 } from 'lucide-react';
import { getReportDownloadUrl } from '../services/api';
import type { InspectionRecord } from '../types/inspection';

interface ReportsViewProps {
  records: InspectionRecord[];
  loading: boolean;
  onSearchChange: (search: string, mode: string, status: string) => void;
  onViewReport: (record: InspectionRecord) => void;
  onDeleteReport: (id: string) => void;
}

export function ReportsView({
  records,
  loading,
  onSearchChange,
  onViewReport,
  onDeleteReport,
}: ReportsViewProps) {
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const triggerFilter = (nextSearch: string, nextMode: string, nextStatus: string) => {
    onSearchChange(nextSearch, nextMode, nextStatus);
  };

  return (
    <div className="space-y-4">
      {/* Filter & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#2A303C] bg-[#161A22] p-3.5">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              const val = e.target.value;
              setSearch(val);
              triggerFilter(val, modeFilter, statusFilter);
            }}
            placeholder="Search by Inspection ID, site, zone, or inspector..."
            className="w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] py-2 pl-9 pr-3 text-xs text-[#F3F4F6] placeholder-[#6B7280] focus:border-[#FACC15] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <select
            value={modeFilter}
            onChange={(e) => {
              const val = e.target.value;
              setModeFilter(val);
              triggerFilter(search, val, statusFilter);
            }}
            className="rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-2.5 py-2 text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="combined">Combined</option>
            <option value="cracks">Crack Detection</option>
            <option value="helmets">Helmet Detection</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              const val = e.target.value;
              setStatusFilter(val);
              triggerFilter(search, modeFilter, val);
            }}
            className="rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-2.5 py-2 text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="Nominal">Nominal</option>
            <option value="Attention Required">Attention Required</option>
            <option value="Safety Violation">Safety Violation</option>
            <option value="Critical Alert">Critical Alert</option>
          </select>
        </div>
      </div>

      {/* Inspection History Table */}
      <div className="overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#161A22]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#2A303C] bg-[#13161D] text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <th className="px-4 py-3">Inspection ID</th>
                <th className="px-3 py-3">Date &amp; Time</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3 text-right">Cracks</th>
                <th className="px-3 py-3 text-right">Workers</th>
                <th className="px-3 py-3 text-right">Violations</th>
                <th className="px-3 py-3 text-right">Compliance %</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-4 py-3 text-right">Report Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2A303C]">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[#9CA3AF]">
                    Loading inspection reports...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#9CA3AF]">
                    No inspection reports match the current filters. Run an inspection to generate a report.
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const cracks = rec.crack_results ? rec.crack_results.total_cracks : '-';
                  const workers = rec.helmet_results ? rec.helmet_results.total_workers : '-';
                  const violations = rec.helmet_results ? rec.helmet_results.workers_without_helmet : '-';
                  const compliance =
                    rec.helmet_results && rec.helmet_results.helmet_compliance_percent !== null
                      ? `${rec.helmet_results.helmet_compliance_percent.toFixed(1)}%`
                      : '-';

                  const statusColor =
                    rec.status === 'Nominal'
                      ? 'text-[#16A34A]'
                      : rec.status === 'Attention Required'
                        ? 'text-[#EA580C]'
                        : 'text-[#DC2626]';

                  return (
                    <tr key={rec.id} className="hover:bg-[#1B202A]">
                      <td className="px-4 py-2.5 font-mono font-medium text-[#F3F4F6] whitespace-nowrap">
                        {rec.id}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[#9CA3AF] whitespace-nowrap">
                        {new Date(rec.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 font-mono uppercase text-[#D1D5DB] whitespace-nowrap">
                        {rec.mode}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#FACC15]">{cracks}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#F3F4F6]">{workers}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#DC2626]">{violations}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#D1D5DB]">{compliance}</td>
                      <td className={`px-3 py-2.5 font-mono font-medium whitespace-nowrap ${statusColor}`}>
                        {rec.status}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onViewReport(rec)}
                            className="inline-flex items-center gap-1 rounded-[3px] border border-[#2A303C] bg-[#1E232D] px-2.5 py-1 text-[11px] font-medium text-[#F3F4F6] hover:bg-[#262C38]"
                          >
                            <Eye className="h-3 w-3" />
                            View Report
                          </button>
                          <a
                            href={getReportDownloadUrl(rec.id)}
                            download={`${rec.id}_inspection_report.pdf`}
                            className="inline-flex items-center gap-1 rounded-[3px] bg-[#FACC15] px-2.5 py-1 text-[11px] font-semibold text-[#0E1116] hover:bg-[#EAB308]"
                          >
                            <Download className="h-3 w-3" />
                            PDF
                          </a>
                          <button
                            type="button"
                            onClick={() => onDeleteReport(rec.id)}
                            title="Delete inspection record"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-[3px] border border-[#2A303C] bg-[#11141A] text-[#6B7280] hover:border-[#DC2626] hover:text-[#DC2626]"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
