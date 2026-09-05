import React, { useMemo, useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { inr } from '@/components/Layout';

// Searchable single-select combobox. `options` is [{value, label}].
function SearchSelect({ options, value, onChange, placeholder, disabled, testId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const onClickOutside = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(o => o.label.toLowerCase().includes(needle));
  }, [options, q]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button" disabled={disabled} data-testid={testId}
        onClick={() => { setOpen(v => !v); setQ(''); }}
        className="w-full h-9 px-3 border border-slate-300 rounded text-sm bg-white text-left flex items-center justify-between disabled:bg-slate-100 disabled:text-slate-400"
      >
        <span className={selected ? '' : 'text-slate-400'}>{selected ? selected.label : (placeholder || 'Select…')}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Type to search…" className="w-full text-sm outline-none"
              data-testid={testId ? `${testId}-search` : undefined}
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No matches</div>}
            {filtered.map(o => (
              <button
                key={o.value} type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 ${o.value === value ? 'bg-blue-50 font-medium text-blue-700' : ''}`}
              >{o.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hierarchical Main Area -> Sub Stop bus picker (PARTS 25-28).
 * `stops` = the flat bus_stops list from GET /api/bus-stops (each row has
 * main_area, stop_name, stop_no, monthly_fee). Selecting a Main Area clears
 * any Sub Stop that no longer belongs to it. Fee is always read-only,
 * derived from the exact selected stop - never typed.
 */
export default function BusStopPicker({ stops, mainArea, stopNo, onChange, disabled }) {
  const areas = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of stops) {
      if (!seen.has(s.main_area)) { seen.add(s.main_area); out.push(s.main_area); }
    }
    return out.sort().map(a => ({ value: a, label: a }));
  }, [stops]);

  const subStops = useMemo(() => {
    if (!mainArea) return [];
    return stops
      .filter(s => s.main_area === mainArea && s.active !== false)
      .sort((a, b) => a.stop_name.localeCompare(b.stop_name))
      .map(s => ({ value: s.stop_no, label: s.stop_name, fee: s.monthly_fee }));
  }, [stops, mainArea]);

  const selectedStop = subStops.find(s => s.value === stopNo);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <label className="block">
        <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Main Bus Stop / Area</div>
        <SearchSelect
          options={areas} value={mainArea} disabled={disabled}
          placeholder="Select area…" testId="bus-main-area"
          onChange={(v) => onChange({ mainArea: v, stopNo: null, monthlyFee: null })}
        />
      </label>
      <label className="block">
        <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Sub Stop</div>
        <SearchSelect
          options={subStops} value={stopNo} disabled={disabled || !mainArea}
          placeholder={mainArea ? 'Select stop…' : 'Select area first'} testId="bus-sub-stop"
          onChange={(v) => {
            const s = subStops.find(x => x.value === v);
            onChange({ mainArea, stopNo: v, monthlyFee: s ? s.fee : null });
          }}
        />
      </label>
      <label className="block">
        <div className="text-[11px] uppercase tracking-wide text-slate-600 mb-1">Monthly Bus Fee</div>
        <div className="h-9 px-3 border border-slate-200 bg-slate-50 rounded text-sm flex items-center font-mono tabular text-slate-700" data-testid="bus-monthly-fee">
          {selectedStop ? inr(selectedStop.fee) : '—'}
        </div>
      </label>
    </div>
  );
}
