// Cafinity — OTP Verification Flow Fix
import { useEffect, useRef } from "react";

interface OtpDigitInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}

export function OtpDigitInput({ value, onChange, onComplete, disabled = false }: OtpDigitInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (value.length === 6) {
      onComplete?.(value);
    }
  }, [value, onComplete]);

  const updateDigit = (index: number, nextChar: string) => {
    const sanitized = nextChar.replace(/\D/g, "").slice(-1);
    const next = digits.slice();
    next[index] = sanitized;
    const joined = next.join("").slice(0, 6);
    onChange(joined);
    if (sanitized && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  return (
    <div className="flex items-center justify-center gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(event) => updateDigit(index, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digits[index] && index > 0) {
              inputsRef.current[index - 1]?.focus();
            }
          }}
          className="h-12 w-10 rounded-xl border-2 border-[#e4d9c7] bg-[#fcfaf4] text-center text-lg font-bold text-slate-900 outline-none transition-all focus:border-[#df734f] focus:bg-white"
        />
      ))}
    </div>
  );
}

export function formatOtpCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
