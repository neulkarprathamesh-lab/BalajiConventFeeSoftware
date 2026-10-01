import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/Layout';
import { FileEdit, CalendarClock, ArrowRight } from 'lucide-react';

// A single entry menu for the two related-but-separate workflows: creating a
// Fee Adjustment (waiver/scholarship/correction against a student's balance)
// and creating a Payment Extension Application (an installment schedule for
// existing outstanding fee). They are NOT merged into one workflow - each
// keeps its own existing, already-working page/design; this screen only
// gives them one shared front door, per the "one main menu, two options"
// requirement.
export default function FeeAdjustmentExtension() {
  const nav = useNavigate();
  return (
    <>
      <PageHeader title="Fee Adjustment / Extension" subtitle="Choose what you want to create" />
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
          <button
            data-testid="fae-new-adjustment"
            onClick={() => nav('/adjustments?new=1')}
            className="text-left bg-white border border-slate-200 rounded-lg p-6 hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <FileEdit className="w-8 h-8 text-blue-600 mb-3" />
            <div className="font-heading text-lg font-semibold text-slate-900 flex items-center gap-2">
              New Adjustment <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-sm text-slate-600 mt-1">Scholarship, waiver, or correction against a student's fee balance — search by student name, then submit for approval.</div>
          </button>

          <button
            data-testid="fae-new-extension"
            onClick={() => nav('/extensions?new=1')}
            className="text-left bg-white border border-slate-200 rounded-lg p-6 hover:border-blue-400 hover:shadow-md transition-all group"
          >
            <CalendarClock className="w-8 h-8 text-blue-600 mb-3" />
            <div className="font-heading text-lg font-semibold text-slate-900 flex items-center gap-2">
              New Extension <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="text-sm text-slate-600 mt-1">Payment Extension Application — search by student name, fee details auto-fill, propose up to 4 installments, print/export.</div>
          </button>
        </div>
      </div>
    </>
  );
}
