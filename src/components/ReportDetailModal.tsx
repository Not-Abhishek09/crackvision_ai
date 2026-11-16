import { Download, X } from 'lucide-react';
import { getReportDownloadUrl, getStorageUrl } from '../services/api';
import type { InspectionRecord } from '../types/inspection';

interface ReportDetailModalProps {
  record: InspectionRecord | null;
  onClose: () => void;
}

export function ReportDetailModal({ record, onClose }: ReportDetailModalProps) {
  if (!record) return null;

  const crack = record.crack_results;
  const helmet = record.helmet_results;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Inspection Report ${record.id}`}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[4px] border border-[#2A303C] bg-[#161A22]">
        <div className="flex items-center justify-between gap-4 border-b border-[#2A303C] bg-[#13161D] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[#F3F4F6]">
              Inspection Report · <span className="font-mono text-[#FACC15]">{record.id}</span>
            </h2>
            <p className="mt-0.5 text-xs text-[#9CA3AF]">
              {new Date(record.created_at).toLocaleString()} · {record.site_name} ({record.zone_label})
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={getReportDownloadUrl(record.id)}
              download={`${record.id}_inspection_report.pdf`}
              className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#FACC15] px-3 py-1.5 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border border-[#2A303C] bg-[#1E232D] text-[#D1D5DB] hover:text-white"
              aria-label="Close report"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          {/* 1. GENERAL INFORMATION */}
          <section className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#FACC15]">
              1. General Information
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-[#9CA3AF]">Inspection ID</dt>
                <dd className="font-mono text-[#F3F4F6]">{record.id}</dd>
                <dt className="text-[#9CA3AF]">Date &amp; Time</dt>
                <dd className="font-mono text-[#F3F4F6]">{new Date(record.created_at).toLocaleString()}</dd>
                <dt className="text-[#9CA3AF]">Inspection Type</dt>
                <dd className="font-mono uppercase text-[#F3F4F6]">{record.mode}</dd>
                <dt className="text-[#9CA3AF]">Source Input</dt>
                <dd className="font-mono uppercase text-[#F3F4F6]">{record.source_type}</dd>
                <dt className="text-[#9CA3AF]">Site &amp; Zone</dt>
                <dd className="text-[#F3F4F6]">{record.site_name} · {record.zone_label}</dd>
                <dt className="text-[#9CA3AF]">Inspector</dt>
                <dd className="text-[#F3F4F6]">{record.inspector_name}</dd>
                <dt className="text-[#9CA3AF]">Status</dt>
                <dd className="font-semibold text-[#FACC15]">{record.status}</dd>
                <dt className="text-[#9CA3AF]">Inference Engine</dt>
                <dd className="font-mono text-[#D1D5DB]">
                  {record.inference_engine} ({record.processing_time_ms} ms)
                </dd>
              </dl>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[#9CA3AF]">Original Inspection Image</p>
                <div className="overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#0E1116]">
                  <img
                    src={getStorageUrl(record.original_image_key)}
                    alt={`Original frame for ${record.id}`}
                    className="max-h-56 w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2. STRUCTURAL INSPECTION */}
          {crack && (
            <section className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#FACC15]">
                  2. Structural Inspection
                </h3>
                <span className="font-mono text-xs text-[#D1D5DB]">
                  {crack.module_error
                    ? 'Module Error'
                    : crack.total_cracks > 0
                      ? `Cracks: ${crack.total_cracks} · Estimated Severity: ${crack.estimated_overall_severity}`
                      : crack.image_quality === 'uncertain'
                        ? 'Status: Uncertain Result'
                        : 'Status: No Cracks Detected'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2.5 text-xs">
                  <p className="text-[#D1D5DB]">{crack.notes}</p>
                  {crack.module_error ? (
                    <p className="rounded-[4px] border border-[#DC2626]/40 bg-[#DC2626]/10 p-3 text-[#FCA5A5]">
                      Crack detection module error: {crack.module_error}
                    </p>
                  ) : crack.detections.length > 0 ? (
                    <div className="divide-y divide-[#2A303C] rounded-[4px] border border-[#2A303C] bg-[#161A22]">
                      {crack.detections.map((d) => (
                        <div key={d.id} className="p-2.5">
                          <div className="flex items-center justify-between font-mono">
                            <span className="font-semibold text-[#FACC15]">
                              {d.id} · {d.classification}
                            </span>
                            <span className="text-[#F3F4F6]">
                              {d.severity} · {(d.model_reported_confidence * 100).toFixed(1)}% conf
                            </span>
                          </div>
                          <p className="mt-1 text-[#9CA3AF]">
                            Box: [{d.pixel_box.x}, {d.pixel_box.y}, {d.pixel_box.width}×{d.pixel_box.height}px] · {d.location_description}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : crack.image_quality === 'uncertain' ? (
                    <p className="rounded-[4px] border border-[#EA580C]/40 bg-[#EA580C]/10 p-3 text-[#FDBA74]">
                      Uncertain Result: {crack.uncertain_reason || 'Image quality insufficient for reliable crack inspection.'}
                    </p>
                  ) : (
                    <p className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-3 text-[#86EFAC]">
                      No structural cracks detected on this surface.
                    </p>
                  )}
                  <p className="text-[11px] text-[#9CA3AF]">{crack.severity_disclaimer}</p>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[#9CA3AF]">Annotated Crack Image</p>
                  <div className="overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#0E1116]">
                    <img
                      src={getStorageUrl(record.crack_annotated_key || record.annotated_image_key)}
                      alt={`Annotated crack inspection for ${record.id}`}
                      className="max-h-56 w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 3. WORKER SAFETY INSPECTION */}
          {helmet && (
            <section className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#FACC15]">
                  3. Worker Safety Inspection
                </h3>
                <span className="font-mono text-xs text-[#D1D5DB]">
                  Compliance:{' '}
                  {helmet.helmet_compliance_percent !== null
                    ? `${helmet.helmet_compliance_percent.toFixed(1)}%`
                    : 'N/A (0 workers)'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2.5 text-xs">
                  <div className="grid grid-cols-4 gap-2 font-mono">
                    <div className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-2">
                      <span className="block text-[10px] text-[#9CA3AF]">Total</span>
                      <span className="text-sm font-semibold text-[#F3F4F6]">{helmet.total_workers}</span>
                    </div>
                    <div className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-2">
                      <span className="block text-[10px] text-[#9CA3AF]">Helmet OK</span>
                      <span className="text-sm font-semibold text-[#16A34A]">{helmet.workers_wearing_helmet}</span>
                    </div>
                    <div className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-2">
                      <span className="block text-[10px] text-[#9CA3AF]">No Helmet</span>
                      <span className="text-sm font-semibold text-[#DC2626]">{helmet.workers_without_helmet}</span>
                    </div>
                    <div className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-2">
                      <span className="block text-[10px] text-[#9CA3AF]">Uncertain</span>
                      <span className="text-sm font-semibold text-[#EA580C]">{helmet.uncertain_detections}</span>
                    </div>
                  </div>

                  {helmet.detections.length > 0 && (
                    <div className="divide-y divide-[#2A303C] rounded-[4px] border border-[#2A303C] bg-[#161A22]">
                      {helmet.detections.map((w) => {
                        const colorClass =
                          w.classification === 'helmet_detected'
                            ? 'text-[#16A34A]'
                            : w.classification === 'no_helmet'
                              ? 'text-[#DC2626]'
                              : 'text-[#EA580C]';
                        return (
                          <div key={w.id} className="p-2.5">
                            <div className="flex items-center justify-between font-mono">
                              <span className={`font-semibold ${colorClass}`}>
                                {w.id} · {w.classification.replace('_', ' ').toUpperCase()}
                              </span>
                              <span className="text-[#D1D5DB]">
                                {(w.model_reported_confidence * 100).toFixed(1)}% model conf
                              </span>
                            </div>
                            <p className="mt-1 text-[#9CA3AF]">{w.reason}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[#9CA3AF]">Annotated Worker Helmet Image</p>
                  <div className="overflow-hidden rounded-[4px] border border-[#2A303C] bg-[#0E1116]">
                    <img
                      src={getStorageUrl(record.helmet_annotated_key || record.annotated_image_key)}
                      alt={`Annotated helmet inspection for ${record.id}`}
                      className="max-h-56 w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 4. FINAL SUMMARY */}
          <section className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-4 text-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#FACC15]">
              4. Final Summary &amp; Corrective Actions
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              {record.summary.structural_findings.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[#F3F4F6]">Structural Inspection Findings</h4>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[#D1D5DB]">
                    {record.summary.structural_findings.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.summary.worker_safety_findings.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[#F3F4F6]">Worker Safety Findings</h4>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[#D1D5DB]">
                    {record.summary.worker_safety_findings.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.summary.potential_hazards.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[#DC2626]">Potential Hazards</h4>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[#FCA5A5]">
                    {record.summary.potential_hazards.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {record.summary.recommended_actions.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[#F3F4F6]">Recommended Corrective Actions</h4>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[#D1D5DB]">
                    {record.summary.recommended_actions.map((f, idx) => (
                      <li key={idx}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {record.summary.manual_verification_warnings.length > 0 && (
              <div className="mt-3 border-t border-[#2A303C] pt-3">
                <h4 className="font-semibold text-[#EA580C]">Manual Verification Warnings</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[#9CA3AF]">
                  {record.summary.manual_verification_warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
