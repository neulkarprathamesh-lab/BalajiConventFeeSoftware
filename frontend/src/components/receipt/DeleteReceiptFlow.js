import React, { useState } from 'react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { Trash2, Lock } from 'lucide-react';
import { inr } from '@/components/Layout';

/**
 * Shared Administrator "Delete Receipt" flow — PIN entry, then a final
 * confirmation showing Receipt No./Student/Amount/Date, then the actual
 * DELETE call. Used from both the Receipts list (dustbin icon per row) and
 * the single-receipt view, so the destructive path is exercised identically
 * everywhere it appears rather than duplicated. The backend independently
 * re-checks role + PIN on every call regardless of which screen triggered it.
 */
export function DustbinButton({ receipt, onDeleted, className = '' }) {
  const [stage, setStage] = useState(null); // null | 'pin' | 'confirm'
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (e) => { e?.stopPropagation(); setStage('pin'); };
  const close = () => { setStage(null); setPin(''); };
  const submitPin = (e) => {
    e?.preventDefault(); e?.stopPropagation();
    if (!pin.trim()) return toast.error('Enter the deletion PIN');
    setStage('confirm');
  };
  const confirmDelete = async (e) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      await api.delete(`/receipts/${receipt.id}`, { headers: { 'X-Receipt-Delete-Pin': pin } });
      toast.success(`Receipt ${receipt.number} permanently deleted`);
      close();
      onDeleted && onDeleted(receipt);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Invalid deletion PIN.');
      setStage('pin');
    }
    setPin('');
    setBusy(false);
  };

  return (
    <>
      <button onClick={open} title="Delete Receipt" className={`text-red-600 hover:text-red-800 ${className}`} data-testid={`dustbin-${receipt.number}`}>
        <Trash2 className="w-4 h-4" />
      </button>

      {stage === 'pin' && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); close(); }}>
          <form onSubmit={submitPin} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
            <div className="p-5 border-b border-slate-200">
              <div className="font-heading font-bold text-slate-900">Delete Receipt</div>
              <div className="text-[12px] text-slate-600 mt-1">Enter the Receipt Deletion PIN to permanently delete this receipt.</div>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <div className="text-[11px] uppercase tracking-widest text-slate-600 font-bold mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Deletion PIN</div>
                <input type="password" inputMode="numeric" autoFocus maxLength={8} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" className="w-full h-11 px-3 border-2 border-slate-300 rounded font-mono text-lg tracking-widest text-center focus:ring-2 focus:ring-red-600 focus:border-red-600 focus:outline-none" data-testid="dustbin-pin-input" />
              </label>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); close(); }} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 h-9 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold" data-testid="dustbin-pin-next">Delete Receipt</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {stage === 'confirm' && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); close(); }}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-red-600">
            <div className="p-5 border-b border-slate-200">
              <div className="font-heading font-bold text-red-700">WARNING</div>
              <div className="text-[12px] text-slate-700 mt-1">This will permanently delete the receipt and cannot be undone.</div>
            </div>
            <div className="p-5 space-y-2 text-[13px]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-slate-50 border border-slate-200 rounded p-3">
                <div className="text-slate-500">Receipt No.</div><div className="font-mono font-medium">{receipt.number}</div>
                <div className="text-slate-500">Student/Payer</div><div className="font-medium">{receipt.payer_name || receipt.student_snapshot?.name || '-'}</div>
                <div className="text-slate-500">Amount</div><div className="font-mono font-medium">{inr(receipt.total)}</div>
                <div className="text-slate-500">Date</div><div>{new Date(receipt.created_at).toLocaleDateString('en-IN')}</div>
              </div>
              <div className="flex items-center gap-2 pt-3">
                <button type="button" onClick={(e) => { e.stopPropagation(); close(); }} className="h-9 px-4 border border-slate-300 rounded text-sm hover:bg-slate-50">Cancel</button>
                <button onClick={confirmDelete} disabled={busy} className="flex-1 h-9 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white rounded text-sm font-semibold" data-testid="dustbin-confirm">
                  {busy ? 'Deleting…' : 'PERMANENTLY DELETE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
