"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Client, CreateClientInput } from "@opcify/core";

interface ClientFormModalProps {
  client?: Client | null;
  onClose: () => void;
  onSubmit: (data: CreateClientInput) => Promise<void>;
  submitting: boolean;
}

export function ClientFormModal({
  client,
  onClose,
  onSubmit,
  submitting,
}: ClientFormModalProps) {
  const isEdit = !!client;
  const [name, setName] = useState(client?.name ?? "");
  const [company, setCompany] = useState(client?.company ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [website, setWebsite] = useState(client?.website ?? "");
  const [address, setAddress] = useState(client?.address ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [status, setStatus] = useState<"active" | "inactive" | "archived">(client?.status as "active" | "inactive" | "archived" ?? "active");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        status: status as "active" | "inactive" | "archived",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border-muted bg-surface-raised p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary">
            {isEdit ? "Edit Client" : "Add Client"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Client name"
              className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
              autoFocus
              required
            />
          </div>

          {/* Company */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Company
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company name"
              className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
            />
          </div>

          {/* Email + Phone row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
              />
            </div>
          </div>

          {/* Website */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Website
            </label>
            <input
              type="text"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
            />
          </div>

          {/* Address */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this client..."
              rows={3}
              className="w-full resize-none rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
            />
          </div>

          {/* Status (only shown in edit mode) */}
          {isEdit && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive" | "archived")}
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-border-muted px-4 py-2 text-sm font-medium text-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting
                ? isEdit
                  ? "Saving..."
                  : "Creating..."
                : isEdit
                  ? "Save Changes"
                  : "Add Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
