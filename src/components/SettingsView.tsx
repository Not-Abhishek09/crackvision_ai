import { useEffect, useState } from 'react';
import { Check, Save } from 'lucide-react';
import { saveSettings } from '../services/api';
import type { HealthStatus, SiteSettings } from '../types/inspection';

interface SettingsViewProps {
  settings: SiteSettings | null;
  health: HealthStatus | null;
  onSettingsSaved: (updated: SiteSettings) => void;
}

export function SettingsView({ settings, health, onSettingsSaved }: SettingsViewProps) {
  const [form, setForm] = useState<SiteSettings>({
    site_name: 'North Sector Structural Site',
    zone_label: 'Zone A - Primary Deck',
    inspector_name: 'Site Safety Engineer',
    crack_confidence_threshold: 0.35,
    helmet_confidence_threshold: 0.4,
    auto_scan_interval_sec: 3,
    python_backend_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSavedNotice(false);
    try {
      const updated = await saveSettings(form);
      onSettingsSaved(updated);
      setSavedNotice(true);
      window.setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-[4px] border border-[#2A303C] bg-[#161A22] p-5"
      >
        <div className="border-b border-[#2A303C] pb-3">
          <h2 className="text-sm font-semibold text-[#F3F4F6]">Site &amp; Inspector Configuration</h2>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            Persisted in SQLite and embedded automatically in generated PDF inspection reports.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-[#D1D5DB]">Project Site Name</label>
            <input
              type="text"
              value={form.site_name}
              onChange={(e) => setForm({ ...form, site_name: e.target.value })}
              className="mt-1.5 w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#D1D5DB]">Zone / Structure Label</label>
            <input
              type="text"
              value={form.zone_label}
              onChange={(e) => setForm({ ...form, zone_label: e.target.value })}
              className="mt-1.5 w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#D1D5DB]">Inspector Name</label>
            <input
              type="text"
              value={form.inspector_name}
              onChange={(e) => setForm({ ...form, inspector_name: e.target.value })}
              className="mt-1.5 w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-[#2A303C] pt-4">
          <h3 className="text-sm font-semibold text-[#F3F4F6]">AI Inference &amp; Camera Sampling</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-[#D1D5DB]">
                Crack Confidence Cutoff ({Math.round(form.crack_confidence_threshold * 100)}%)
              </label>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={form.crack_confidence_threshold}
                onChange={(e) =>
                  setForm({ ...form, crack_confidence_threshold: Number(e.target.value) })
                }
                className="mt-2 w-full accent-[#FACC15]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DB]">
                Helmet Confidence Cutoff ({Math.round(form.helmet_confidence_threshold * 100)}%)
              </label>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={form.helmet_confidence_threshold}
                onChange={(e) =>
                  setForm({ ...form, helmet_confidence_threshold: Number(e.target.value) })
                }
                className="mt-2 w-full accent-[#FACC15]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D1D5DB]">
                Default Live Scan Interval
              </label>
              <select
                value={form.auto_scan_interval_sec}
                onChange={(e) =>
                  setForm({ ...form, auto_scan_interval_sec: Number(e.target.value) })
                }
                className="mt-1.5 w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-3 py-2 font-mono text-xs text-[#F3F4F6] focus:border-[#FACC15] focus:outline-none"
              >
                <option value={1}>1 second</option>
                <option value={2}>2 seconds</option>
                <option value={3}>3 seconds (Default)</option>
                <option value={5}>5 seconds</option>
                <option value={10}>10 seconds</option>
              </select>
            </div>
          </div>
        </div>

        <div className="border-t border-[#2A303C] pt-4">
          <label className="block text-xs font-medium text-[#D1D5DB]">
            Optional External Python FastAPI + YOLO Inference URL
          </label>
          <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
            Leave blank to run built-in server-side Gemini Vision inference. Provide a deployed FastAPI
            base URL (e.g. http://localhost:8000) to delegate inference to custom YOLO weights.
          </p>
          <input
            type="url"
            value={form.python_backend_url}
            onChange={(e) => setForm({ ...form, python_backend_url: e.target.value })}
            placeholder="http://localhost:8000"
            className="mt-2 w-full rounded-[4px] border border-[#2A303C] bg-[#0E1116] px-3 py-2 font-mono text-xs text-[#F3F4F6] placeholder-[#6B7280] focus:border-[#FACC15] focus:outline-none"
          />
        </div>

        {errorMsg && (
          <p className="rounded-[4px] border border-[#DC2626]/50 bg-[#DC2626]/10 px-3 py-2 text-xs text-[#FCA5A5]">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-[#2A303C] pt-4">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs text-[#16A34A]">
              <Check className="h-3.5 w-3.5" /> Settings saved
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#FACC15] px-4 py-2 text-xs font-semibold text-[#0E1116] hover:bg-[#EAB308] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* System Diagnostics & Drone Readiness */}
      <section className="rounded-[4px] border border-[#2A303C] bg-[#161A22] p-5 text-xs">
        <h3 className="text-sm font-semibold text-[#F3F4F6]">
          Runtime Storage, Model &amp; Remote Camera Readiness
        </h3>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
            <dt className="text-[11px] text-[#9CA3AF]">Persistent Image &amp; PDF Storage</dt>
            <dd className="mt-1 font-mono text-[#F3F4F6]">
              {health?.storage.backend.toUpperCase() || 'LOCAL'} · {health?.storage.location || './data/storage'}
            </dd>
          </div>
          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
            <dt className="text-[11px] text-[#9CA3AF]">SQLite Database</dt>
            <dd className="mt-1 truncate font-mono text-[#F3F4F6]">
              {health?.database.path || './data/construction_vision.db'}
            </dd>
          </div>
          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
            <dt className="text-[11px] text-[#9CA3AF]">Configured AI Vision Model</dt>
            <dd className="mt-1 font-mono text-[#F3F4F6]">
              {health?.ai_model.model || 'gemini-4-hydrogen'} ({health?.ai_model.available ? 'Verified' : 'Check Key'})
            </dd>
          </div>
          <div className="rounded-[4px] border border-[#2A303C] bg-[#11141A] p-3">
            <dt className="text-[11px] text-[#9CA3AF]">Remote / Drone Ingestion Hook</dt>
            <dd className="mt-1 font-mono text-[#D1D5DB]">
              POST /api/inspect/combined (source_type=&quot;drone_feed&quot; + telemetry JSON)
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
