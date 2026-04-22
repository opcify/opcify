"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { User, LogOut, ChevronDown, X, Camera, Globe, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { updateProfile } from "@/lib/auth";

interface UserProfileDropdownProps {
  /** Compact mode hides the name and only shows the avatar (useful for mobile headers) */
  compact?: boolean;
}

// Mock user — replace with real auth context when available
const initialUser = {
  name: "Yang Qi",
  email: "yangqi@opcify.com",
  initials: "YQ",
  role: "Owner",
  company: "Opcify",
  timezone: "UTC",
};

/** Get list of IANA timezones, grouped by region. */
function getTimezoneList(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (key: string) => string[] })
      .supportedValuesOf("timeZone");
  } catch {
    // Fallback for older browsers
    return [
      "UTC",
      "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
      "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin",
      "Asia/Tokyo", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai",
      "Australia/Sydney", "Pacific/Auckland",
    ];
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ─── Timezone Combobox ──────────────────────────────────────────────

function TimezoneCombobox({
  timezones,
  value,
  onChange,
}: {
  timezones: string[];
  value: string;
  onChange: (tz: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query) return timezones;
    const q = query.toLowerCase();
    return timezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [timezones, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function select(tz: string) {
    onChange(tz);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlightIdx]) {
        select(filtered[highlightIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-secondary">
        <Globe className="h-3.5 w-3.5" />
        Timezone
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : value.replace(/_/g, " ")}
          placeholder="Search timezone..."
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => { setQuery(e.target.value); setHighlightIdx(0); if (!open) setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="w-full rounded-lg border border-border-muted bg-surface py-2 pl-9 pr-3 text-sm text-primary placeholder-muted outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
        />
      </div>
      {open && (
        <ul
          ref={listRef}
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-border-muted bg-surface-raised shadow-xl"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No timezones found</li>
          ) : (
            filtered.map((tz, i) => (
              <li
                key={tz}
                onMouseDown={() => select(tz)}
                onMouseEnter={() => setHighlightIdx(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
                  tz === value
                    ? "font-medium text-emerald-400"
                    : "text-primary"
                } ${i === highlightIdx ? "bg-surface-overlay" : ""}`}
              >
                {tz.replace(/_/g, " ")}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Profile Modal ──────────────────────────────────────────────────

function ProfileModal({
  user,
  onSave,
  onClose,
}: {
  user: typeof initialUser;
  onSave: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [company, setCompany] = useState(user.company);
  const [timezone, setTimezone] = useState(user.timezone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const timezones = useMemo(() => getTimezoneList(), []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({
        name: name.trim(),
        timezone,
      });
      onSave();
      setSaving(false);
      setSaved(true);
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit profile"
        className="relative w-full max-w-md rounded-xl border border-border-muted bg-surface-raised shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-muted px-6 py-4">
          <h2 className="text-lg font-semibold text-primary">Edit Profile</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {/* Avatar */}
          <div className="mb-6 flex flex-col items-center">
            <div className="group relative">
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-2xl font-bold text-white">
                {getInitials(name || user.name)}
              </span>
              <button className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <Camera className="h-5 w-5 text-white" />
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">Click to change avatar</p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2 text-sm text-primary placeholder-muted outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Email
              </label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2 text-sm text-muted outline-none opacity-60"
                placeholder="you@example.com"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-secondary">
                  Role
                </label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2 text-sm text-primary placeholder-muted outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                  placeholder="e.g. Owner"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-secondary">
                  Company
                </label>
                <input
                  type="text"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2 text-sm text-primary placeholder-muted outline-none transition-colors focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                  placeholder="e.g. Opcify"
                />
              </div>
            </div>

            <TimezoneCombobox
              timezones={timezones}
              value={timezone}
              onChange={setTimezone}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border-muted px-6 py-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-border-muted px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved || !name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dropdown ───────────────────────────────────────────────────────

export function UserProfileDropdown({ compact = false }: UserProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { user: authUser, logout, refresh } = useAuth();
  const derivedUser = useMemo(
    () =>
      authUser
        ? {
            name: authUser.name,
            email: authUser.email,
            initials: getInitials(authUser.name),
            role: "Owner" as const,
            company: "Opcify",
            timezone: authUser.timezone || "UTC",
          }
        : initialUser,
    [authUser],
  );
  const user = derivedUser;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click (check both trigger and portaled menu)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Keyboard navigation inside menu
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items?.length) return;

    const current = document.activeElement as HTMLElement;
    const idx = Array.from(items).indexOf(current);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }, []);

  // Focus first item when menu opens
  useEffect(() => {
    if (open) {
      const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
      requestAnimationFrame(() => firstItem?.focus());
    }
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout();
  };

  // Position the portal dropdown near the trigger button
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  return (
    <>
      <div className="relative" ref={containerRef}>
        {/* Trigger */}
        <button
          ref={triggerRef}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`flex items-center gap-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
            compact
              ? "p-0.5 hover:ring-2 hover:ring-border-muted"
              : "border border-border-muted bg-surface-raised py-1 pl-1 pr-2.5 hover:bg-surface-overlay"
          }`}
        >
          {/* Avatar */}
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
            {user.initials}
          </span>

          {!compact && (
            <>
              <span className="max-w-[120px] truncate text-sm font-medium text-secondary">
                {user.name}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
              />
            </>
          )}
        </button>
      </div>

      {/* Dropdown menu — portaled to body to escape sidebar/header clipping */}
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="User menu"
          onKeyDown={handleMenuKeyDown}
          style={{ top: menuPos.top, right: menuPos.right }}
          className="fixed z-[60] w-56 origin-top-right animate-in fade-in zoom-in-95 rounded-lg border border-border-muted bg-surface-raised shadow-xl"
        >
          {/* User info header */}
          <div className="border-b border-border-muted px-4 py-3">
            <p className="truncate text-sm font-medium text-primary">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                setProfileOpen(true);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-tertiary transition-colors hover:bg-surface-overlay hover:text-secondary focus:bg-surface-overlay focus:text-secondary focus:outline-none"
            >
              <User className="h-4 w-4" />
              Profile
            </button>
          </div>

          {/* Logout */}
          <div className="border-t border-border-muted py-1">
            <button
              role="menuitem"
              tabIndex={-1}
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus:bg-red-500/10 focus:text-red-300 focus:outline-none"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>,
        document.body,
      )}

      {/* Profile modal — portaled to body */}
      {profileOpen && typeof document !== "undefined" && createPortal(
        <ProfileModal
          user={user}
          onSave={() => refresh()}
          onClose={() => setProfileOpen(false)}
        />,
        document.body,
      )}
    </>
  );
}
