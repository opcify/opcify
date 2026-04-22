"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

const options = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
] as const;

// Detect hydration without useEffect + setState (React 19 compatible)
const subscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="flex items-center gap-0.5 rounded-lg bg-surface-overlay/50 p-0.5">
        {options.map((o) => (
          <div key={o.value} className="rounded-md px-2 py-1.5">
            <o.Icon className="h-3.5 w-3.5 text-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-overlay/50 p-0.5">
      {options.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            title={o.label}
            className={`rounded-md px-2 py-1.5 transition-colors ${
              active
                ? "bg-surface-overlay text-primary shadow-sm"
                : "text-muted hover:text-secondary"
            }`}
          >
            <o.Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
