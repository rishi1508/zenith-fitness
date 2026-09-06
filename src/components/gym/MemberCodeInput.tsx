import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface Props {
  length: number;
  values: string[];
  onChange: (values: string[]) => void;
  /** Fires once all boxes are filled (paste of the full code fires it too). */
  onComplete: (value: string) => void;
  charset: 'alnum' | 'digits';
  isDark: boolean;
  disabled?: boolean;
}

/**
 * Segmented code-entry boxes with auto-advance and paste support. Used
 * by JoinGymView (6-char alnum join code) and CheckinView (6-digit daily
 * code) — kept as one shared widget rather than duplicated across both.
 */
export function MemberCodeInput({ length, values, onChange, onComplete, charset, isDark, disabled }: Props) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const invalidChars = charset === 'digits' ? /[^0-9]/g : /[^A-Z0-9]/g;

  const handleChange = (i: number, raw: string) => {
    const cleaned = raw.toUpperCase().replace(invalidChars, '');

    if (cleaned.length > 1) {
      // Pasted the whole code into one box.
      const pasted = cleaned.slice(0, length).split('');
      const next = Array(length).fill('');
      pasted.forEach((c, idx) => { next[idx] = c; });
      onChange(next);
      inputsRef.current[Math.min(pasted.length, length) - 1]?.focus();
      if (next.every((c) => c)) onComplete(next.join(''));
      return;
    }

    const next = [...values];
    next[i] = cleaned;
    onChange(next);
    if (cleaned && i < length - 1) inputsRef.current[i + 1]?.focus();
    if (next.every((c) => c)) onComplete(next.join(''));
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !values[i] && i > 0) inputsRef.current[i - 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-2">
      {values.map((v, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          value={v}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          inputMode={charset === 'digits' ? 'numeric' : 'text'}
          autoCapitalize={charset === 'digits' ? 'off' : 'characters'}
          maxLength={length}
          className={`w-11 h-12 text-center text-lg font-bold rounded-lg border focus:outline-none focus:border-orange-500 disabled:opacity-50 ${
            isDark ? 'bg-[#0f0f0f] border-[#2e2e2e] text-white' : 'bg-gray-50 border-gray-200'
          }`}
        />
      ))}
    </div>
  );
}
