"use client";

import { useState, useRef, useEffect } from "react";
import { Calendar } from "lucide-react";
import { useTimezone } from "@/lib/use-timezone";
import { getTodayStr, toDateStr, parseDateStr } from "@/lib/time";

interface KanbanDateControlProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

function formatDisplayDate(dateStr: string, timezone?: string): string {
  const date = parseDateStr(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  });
}

function addDays(dateStr: string, days: number, timezone?: string): string {
  const date = parseDateStr(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateStr(date, timezone);
}

export function KanbanDateControl({ selectedDate, onDateChange }: KanbanDateControlProps) {
  const timezone = useTimezone();
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const isToday = selectedDate === getTodayStr(timezone);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    if (showCalendar) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCalendar]);

  const [calYear, calMonth] = (() => {
    const [y, m] = selectedDate.split("-").map(Number);
    return [y, m - 1];
  })();

  const [viewYear, setViewYear] = useState(calYear);
  const [viewMonth, setViewMonth] = useState(calMonth);

  useEffect(() => {
    const [y, m] = selectedDate.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
  }, [selectedDate]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  function handleCalendarDayClick(day: number) {
    const m = String(viewMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onDateChange(`${viewYear}-${m}-${d}`);
    setShowCalendar(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); }
    else setViewMonth(viewMonth - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); }
    else setViewMonth(viewMonth + 1);
  }

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone });

  return (
    <div className="flex items-center gap-1.5">
      {!isToday && (
        <button
          onClick={() => onDateChange(getTodayStr(timezone))}
          className="ml-1 flex h-8 items-center rounded-lg bg-emerald-600/10 px-3 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-600/20"
        >
          Today
        </button>
      )}
      <button
        onClick={() => onDateChange(addDays(selectedDate, -1, timezone))}
        className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        title="Previous day"
      >
        ‹
      </button>

      <div className="relative" ref={calendarRef}>
        <button
          onClick={() => setShowCalendar(!showCalendar)}
          className="flex h-8 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:text-white"
        >
          <Calendar className="h-4 w-4 text-zinc-500" />
          {formatDisplayDate(selectedDate, timezone)}
        </button>

        {showCalendar && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-zinc-800 bg-zinc-900 p-3 shadow-2xl shadow-black/50">
            <div className="mb-2 flex items-center justify-between">
              <button onClick={prevMonth} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">‹</button>
              <span className="text-sm font-medium text-zinc-300">{monthLabel}</span>
              <button onClick={nextMonth} className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">›</button>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-zinc-600">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                <span key={d} className="py-1">{d}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {calendarDays.map((day, i) => {
                if (day === null) return <span key={`empty-${i}`} />;
                const m = String(viewMonth + 1).padStart(2, "0");
                const d = String(day).padStart(2, "0");
                const dayStr = `${viewYear}-${m}-${d}`;
                const isSelected = dayStr === selectedDate;
                const isDayToday = dayStr === getTodayStr(timezone);
                return (
                  <button
                    key={dayStr}
                    onClick={() => handleCalendarDayClick(day)}
                    className={`flex h-8 w-full items-center justify-center rounded-md text-xs transition-colors ${
                      isSelected
                        ? "bg-emerald-600 font-semibold text-white"
                        : isDayToday
                          ? "bg-zinc-800 font-medium text-emerald-400"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={() => onDateChange(addDays(selectedDate, 1, timezone))}
        className="hidden sm:flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
        title="Next day"
      >
        ›
      </button>

      
    </div>
  );
}
