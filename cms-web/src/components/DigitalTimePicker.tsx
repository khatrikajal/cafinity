import { ChevronUp, ChevronDown, Clock } from "lucide-react";
import { useState, useEffect } from "react";

interface DigitalTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function DigitalTimePicker({
  value,
  onChange,
  placeholder = "HH:MM",
}: DigitalTimePickerProps) {
  const [hours, setHours] = useState("00");
  const [minutes, setMinutes] = useState("00");
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (value && value.includes(":")) {
      const [h, m] = value.split(":");
      setHours(h.padStart(2, "0"));
      setMinutes(m.padStart(2, "0"));
      setError("");
    }
  }, [value]);

  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 2) val = val.slice(0, 2);
    const num = parseInt(val, 10) || 0;
    if (num < 0 || num > 23) {
      setError("Hour must be 0-23");
      return;
    }
    setError("");
    setHours(val.padStart(2, "0"));
    updateTime(val.padStart(2, "0"), minutes);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 2) val = val.slice(0, 2);
    const num = parseInt(val, 10) || 0;
    if (num < 0 || num > 59) {
      setError("Minutes must be 0-59");
      return;
    }
    setError("");
    setMinutes(val.padStart(2, "0"));
    updateTime(hours, val.padStart(2, "0"));
  };

  const incrementHour = () => {
    const num = (parseInt(hours, 10) + 1) % 24;
    const newHours = String(num).padStart(2, "0");
    setHours(newHours);
    updateTime(newHours, minutes);
  };

  const decrementHour = () => {
    const num = (parseInt(hours, 10) - 1 + 24) % 24;
    const newHours = String(num).padStart(2, "0");
    setHours(newHours);
    updateTime(newHours, minutes);
  };

  const incrementMinute = () => {
    const num = (parseInt(minutes, 10) + 5) % 60;
    const newMinutes = String(num).padStart(2, "0");
    setMinutes(newMinutes);
    updateTime(hours, newMinutes);
  };

  const decrementMinute = () => {
    const num = (parseInt(minutes, 10) - 5 + 60) % 60;
    const newMinutes = String(num).padStart(2, "0");
    setMinutes(newMinutes);
    updateTime(hours, newMinutes);
  };

  const updateTime = (h: string, m: string) => {
    const hNum = parseInt(h, 10);
    const mNum = parseInt(m, 10);
    if (hNum >= 0 && hNum < 24 && mNum >= 0 && mNum < 60) {
      onChange(`${h}:${m}`);
      setError("");
    }
  };

  const setQuickTime = (h: number, m: number) => {
    const newH = String(h).padStart(2, "0");
    const newM = String(m).padStart(2, "0");
    setHours(newH);
    setMinutes(newM);
    updateTime(newH, newM);
    setShowPicker(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <div
          onClick={() => setShowPicker(!showPicker)}
          className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#e6d6c3] bg-[#fffaf4] px-4 py-3 text-sm transition-all hover:border-[#e18b2c] dark:border-[#4f3425] dark:bg-[#221712] dark:hover:border-[#8f6138]"
        >
          <Clock className="h-5 w-5 text-[#d36f18] dark:text-[#ffb467]" />
          <span className="font-mono text-lg font-bold text-[#2d1d12] dark:text-[#fff2e4]">
            {hours}:{minutes}
          </span>
        </div>
      </div>

      {showPicker && (
        <div className="absolute right-0 top-full z-50 mt-2 rounded-[20px] border border-[#eadfce] bg-white p-6 shadow-2xl dark:border-[#4b3020] dark:bg-[#1d1410]">
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8c7660]">
                Pickup Time
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 font-mono text-5xl font-bold text-[#2d1d12] dark:text-[#fff2e4]">
                <span>{hours}</span>
                <span className="animate-pulse">:</span>
                <span>{minutes}</span>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-[#f5a8a8] bg-[#fef1f1] px-3 py-2 text-xs font-medium text-[#c63c3c] dark:border-[#8b4545] dark:bg-[#3a1f1f] dark:text-[#ff9999]">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-6">
              {/* Hours */}
              <div className="space-y-3">
                <p className="text-center text-xs font-semibold uppercase text-[#8c7660]">
                  Hours
                </p>
                <button
                  onClick={incrementHour}
                  className="flex w-full items-center justify-center rounded-lg border border-[#e6d6c3] bg-[#fff8ef] py-2 hover:bg-[#fff1d9] dark:border-[#4f3425] dark:bg-[#221712] dark:hover:bg-[#2a1b15]"
                >
                  <ChevronUp className="h-5 w-5 text-[#d36f18]" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={hours}
                  onChange={handleHourChange}
                  className="w-full rounded-lg border border-[#e6d6c3] bg-white px-3 py-3 text-center font-mono text-xl font-bold text-[#2d1d12] outline-none focus:border-[#e18b2c] dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#fff2e4]"
                  maxLength={2}
                />
                <button
                  onClick={decrementHour}
                  className="flex w-full items-center justify-center rounded-lg border border-[#e6d6c3] bg-[#fff8ef] py-2 hover:bg-[#fff1d9] dark:border-[#4f3425] dark:bg-[#221712] dark:hover:bg-[#2a1b15]"
                >
                  <ChevronDown className="h-5 w-5 text-[#d36f18]" />
                </button>
              </div>

              {/* Minutes */}
              <div className="space-y-3">
                <p className="text-center text-xs font-semibold uppercase text-[#8c7660]">
                  Minutes
                </p>
                <button
                  onClick={incrementMinute}
                  className="flex w-full items-center justify-center rounded-lg border border-[#e6d6c3] bg-[#fff8ef] py-2 hover:bg-[#fff1d9] dark:border-[#4f3425] dark:bg-[#221712] dark:hover:bg-[#2a1b15]"
                >
                  <ChevronUp className="h-5 w-5 text-[#d36f18]" />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={minutes}
                  onChange={handleMinuteChange}
                  className="w-full rounded-lg border border-[#e6d6c3] bg-white px-3 py-3 text-center font-mono text-xl font-bold text-[#2d1d12] outline-none focus:border-[#e18b2c] dark:border-[#4f3425] dark:bg-[#1d1410] dark:text-[#fff2e4]"
                  maxLength={2}
                />
                <button
                  onClick={decrementMinute}
                  className="flex w-full items-center justify-center rounded-lg border border-[#e6d6c3] bg-[#fff8ef] py-2 hover:bg-[#fff1d9] dark:border-[#4f3425] dark:bg-[#221712] dark:hover:bg-[#2a1b15]"
                >
                  <ChevronDown className="h-5 w-5 text-[#d36f18]" />
                </button>
              </div>
            </div>

            {/* Quick select */}
            <div className="border-t border-[#efe2d2] pt-4 dark:border-[#4a3023]">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#8c7660]">
                Quick Pick
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "12:00", h: 12, m: 0 },
                  { label: "12:30", h: 12, m: 30 },
                  { label: "1:00 PM", h: 13, m: 0 },
                  { label: "1:30 PM", h: 13, m: 30 },
                  { label: "2:00 PM", h: 14, m: 0 },
                  { label: "3:00 PM", h: 15, m: 0 },
                ].map((time) => (
                  <button
                    key={time.label}
                    onClick={() => setQuickTime(time.h, time.m)}
                    className="rounded-lg border border-[#f5d1a0] bg-[#fff7eb] px-2 py-2 text-xs font-semibold text-[#6d4c22] hover:bg-[#fff1d9] dark:border-[#7f5a30] dark:bg-[#291f12] dark:text-[#ffe5b4] dark:hover:bg-[#3a2817]"
                  >
                    {time.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setShowPicker(false)}
              className="w-full rounded-lg bg-[linear-gradient(135deg,#f3a133_0%,#e07b1f_100%)] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {showPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}
