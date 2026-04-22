"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type {
  LedgerEntryWithClient,
  CreateLedgerEntryInput,
  LedgerEntryType,
  AttachmentType,
} from "@opcify/core";

interface ClientOption {
  id: string;
  name: string;
}

interface TaskOption {
  id: string;
  title: string;
}

interface LedgerEntryModalProps {
  entry?: LedgerEntryWithClient | null;
  clients: ClientOption[];
  tasks?: TaskOption[];
  onClose: () => void;
  onSubmit: (data: CreateLedgerEntryInput) => Promise<void>;
  submitting: boolean;
}

export function LedgerEntryModal({
  entry,
  clients,
  tasks,
  onClose,
  onSubmit,
  submitting,
}: LedgerEntryModalProps) {
  const isEdit = !!entry;
  const [type, setType] = useState<LedgerEntryType>(entry?.type ?? "income");
  const [amount, setAmount] = useState(entry?.amount?.toString() ?? "");
  const [currency] = useState(entry?.currency ?? "USD");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [clientId, setClientId] = useState(entry?.clientId ?? "");
  const [taskId, setTaskId] = useState(entry?.taskId ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  const [attachmentType, setAttachmentType] = useState<AttachmentType | "">(
    entry?.attachmentType ?? "",
  );
  const [attachmentUrl, setAttachmentUrl] = useState(
    entry?.attachmentUrl ?? "",
  );
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [entryDate, setEntryDate] = useState(() => {
    if (entry?.entryDate) {
      return new Date(entry.entryDate).toISOString().split("T")[0];
    }
    return new Date().toISOString().split("T")[0];
  });
  const [error, setError] = useState<string | null>(null);

  const categories =
    type === "income"
      ? ["Service", "Product", "Retainer", "Consulting", "Other"]
      : [
          "Software",
          "Marketing",
          "Office",
          "Travel",
          "Contractor",
          "Equipment",
          "Other",
        ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!description.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please provide a valid amount and description");
      return;
    }

    setError(null);
    try {
      await onSubmit({
        type,
        amount: parsedAmount,
        currency,
        description: description.trim(),
        clientId: clientId || undefined,
        taskId: taskId || undefined,
        category: category || undefined,
        attachmentType: (attachmentType as AttachmentType) || undefined,
        attachmentUrl: attachmentUrl.trim() || undefined,
        notes: notes.trim() || undefined,
        entryDate,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border-muted bg-surface-raised p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-primary">
            {isEdit ? "Edit Entry" : "Add Entry"}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface-overlay hover:text-secondary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Type toggle */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Type <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setType("income")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  type === "income"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-border-muted text-muted hover:bg-surface-overlay"
                }`}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => setType("expense")}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  type === "expense"
                    ? "border-red-500/30 bg-red-500/10 text-red-400"
                    : "border-border-muted text-muted hover:bg-surface-overlay"
                }`}
              >
                Expense
              </button>
            </div>
          </div>

          {/* Amount + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Amount ({currency}) <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Description <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?"
              className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
              required
            />
          </div>

          {/* Client + Category row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Client
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
              >
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
              >
                <option value="">No category</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Task (optional) */}
          {tasks && tasks.length > 0 && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Task <span className="text-muted">(optional)</span>
              </label>
              <select
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
              >
                <option value="">No task</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Attachment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-secondary">
                Attachment Type
              </label>
              <select
                value={attachmentType}
                onChange={(e) =>
                  setAttachmentType(e.target.value as AttachmentType | "")
                }
                className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary outline-none focus:border-border-focus"
              >
                <option value="">None</option>
                <option value="invoice">Invoice</option>
                <option value="receipt">Receipt</option>
              </select>
            </div>
            {attachmentType && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-secondary">
                  Attachment URL
                </label>
                <input
                  type="text"
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-secondary">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={2}
              className="w-full resize-none rounded-lg border border-border-muted bg-surface-overlay px-3 py-2 text-sm text-primary placeholder-muted outline-none focus:border-border-focus"
            />
          </div>

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
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting
                ? isEdit
                  ? "Saving..."
                  : "Adding..."
                : isEdit
                  ? "Save Changes"
                  : "Add Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
