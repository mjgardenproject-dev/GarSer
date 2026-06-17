import React from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import {
  MANUAL_ENTRY_CONSENT_TEXT,
  MANUAL_ENTRY_NOTICE_BODY,
  MANUAL_ENTRY_NOTICE_TITLE,
} from '../../../shared/manualEntry/legalCopy';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Info banner (web visual language, not a native alert) + non-prechecked
 * veracity checkbox. Continuation is gated on `checked` upstream.
 */
export const ManualEntryConsent: React.FC<Props> = ({ checked, onChange }) => {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" aria-hidden />
        <div>
          <p className="font-semibold text-blue-900">{MANUAL_ENTRY_NOTICE_TITLE}</p>
          <p className="text-sm text-blue-800/90 mt-1 leading-relaxed">{MANUAL_ENTRY_NOTICE_BODY}</p>
        </div>
      </div>

      <label className="flex items-start gap-3 cursor-pointer bg-white border border-gray-200 rounded-xl p-4 hover:border-green-300 transition">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-5 w-5 accent-green-600 shrink-0"
        />
        <span className="text-sm text-gray-700 leading-relaxed flex-1">
          <ShieldCheck className="inline w-4 h-4 text-green-600 mr-1 -mt-0.5" aria-hidden />
          {MANUAL_ENTRY_CONSENT_TEXT}
        </span>
      </label>
    </div>
  );
};
