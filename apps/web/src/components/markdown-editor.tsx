"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Ignored when `fill` is true. */
  height?: number;
  /** Compact mode uses smaller default height for modals. Ignored when `fill` is true. */
  compact?: boolean;
  /**
   * Fill the parent container's full height. The parent must be a flex
   * column with `flex-1 min-h-0` (or otherwise have a stretched height).
   * In this mode the underlying MDEditor's internal layout is overridden
   * via scoped CSS so each inner wrapper (`.w-md-editor`, `-content`,
   * `-area`, `-text`) uses `flex: 1` instead of MDEditor's default
   * pixel-based height — that's the only reliable way to make the inner
   * textarea actually stretch, since `.w-md-editor-text-input` is
   * `position: absolute; height: 100%` and only fills its containing
   * block when every ancestor is flex-stretched.
   *
   * Used by the email compose window so the body editor fills the pane.
   */
  fill?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Optional details…",
  height,
  compact = false,
  fill = false,
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState<"edit" | "preview">("edit");
  const editorHeight = fill ? undefined : (height ?? (compact ? 120 : 180));

  return (
    <div
      data-color-mode="dark"
      className={
        fill ? "opcify-md-fill flex min-h-0 flex-1 flex-col" : undefined
      }
    >
      <div className="flex items-center justify-end mb-1 gap-1">
        <button
          type="button"
          onClick={() => setPreview("edit")}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            preview === "edit"
              ? "bg-zinc-800 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-400"
          }`}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setPreview("preview")}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
            preview === "preview"
              ? "bg-zinc-800 text-zinc-200"
              : "text-zinc-500 hover:text-zinc-400"
          }`}
        >
          Preview
        </button>
      </div>
      <MDEditor
        value={value ?? ""}
        onChange={(v) => onChange(v ?? "")}
        preview={preview === "preview" ? "preview" : "edit"}
        hideToolbar={false}
        height={editorHeight}
        textareaProps={{ placeholder }}
        visibleDragbar={false}
        // Disable the prism-based syntax-highlight overlay on the edit pane.
        // It runs `rehype-prism-plus` → `refractor` whenever you type, and
        // `refractor`'s prism-core mutates language definitions on first use
        // (`patternObj.pattern = RegExp(patternObj.pattern.source, …)`); under
        // React 19 strict mode the second render hits a half-mutated state
        // and throws "Cannot read properties of undefined (reading 'source')".
        // We don't need source-pane highlighting for prose (emails, notes,
        // task descriptions), and the preview pane still renders code blocks
        // through a different code path, so this is safe to disable globally.
        highlightEnable={false}
        style={{
          backgroundColor: "rgb(9, 9, 11)", // zinc-950
          borderRadius: "0.5rem",
          border: "1px solid rgb(39, 39, 42)", // zinc-800
          fontSize: "14px",
        }}
      />
      <style jsx global>{`
        .w-md-editor {
          --md-editor-bg-color: rgb(9, 9, 11) !important;
          --md-editor-text-color: rgb(228, 228, 231) !important;
          --md-editor-border-color: rgb(39, 39, 42) !important;
          box-shadow: none !important;
        }
        .w-md-editor .w-md-editor-toolbar {
          background-color: rgb(9, 9, 11) !important;
          border-bottom: 1px solid rgb(39, 39, 42) !important;
          padding: 2px 4px !important;
          min-height: 30px !important;
        }
        .w-md-editor .w-md-editor-toolbar li > button {
          color: rgb(113, 113, 122) !important;
          height: 24px !important;
          width: 24px !important;
        }
        .w-md-editor .w-md-editor-toolbar li > button:hover {
          color: rgb(228, 228, 231) !important;
          background-color: rgb(39, 39, 42) !important;
        }
        .w-md-editor .w-md-editor-toolbar li.active > button {
          color: rgb(228, 228, 231) !important;
          background-color: rgb(39, 39, 42) !important;
        }
        .w-md-editor-text-pre,
        .w-md-editor-text-input,
        .w-md-editor-text {
          font-size: 14px !important;
          line-height: 1.6 !important;
          color: rgb(228, 228, 231) !important;
        }
        .w-md-editor-text-input::placeholder {
          color: rgb(82, 82, 91) !important;
        }
        .w-md-editor .w-md-editor-preview {
          background-color: rgb(9, 9, 11) !important;
          padding: 12px !important;
        }
        .w-md-editor .wmde-markdown {
          background-color: rgb(9, 9, 11) !important;
          color: rgb(228, 228, 231) !important;
          font-size: 14px !important;
        }
        .w-md-editor .wmde-markdown h1,
        .w-md-editor .wmde-markdown h2,
        .w-md-editor .wmde-markdown h3 {
          border-color: rgb(39, 39, 42) !important;
          color: rgb(244, 244, 245) !important;
        }
        .w-md-editor .wmde-markdown code {
          background-color: rgb(24, 24, 27) !important;
          color: rgb(161, 161, 170) !important;
        }
        .w-md-editor .wmde-markdown pre {
          background-color: rgb(24, 24, 27) !important;
          border: 1px solid rgb(39, 39, 42) !important;
        }
        .w-md-editor .wmde-markdown blockquote {
          border-left-color: rgb(63, 63, 70) !important;
          color: rgb(161, 161, 170) !important;
        }
        .w-md-editor .wmde-markdown a {
          color: rgb(96, 165, 250) !important;
        }
        .w-md-editor .wmde-markdown hr {
          border-color: rgb(39, 39, 42) !important;
        }
        .w-md-editor .wmde-markdown table th,
        .w-md-editor .wmde-markdown table td {
          border-color: rgb(39, 39, 42) !important;
        }
        .w-md-editor-bar {
          display: none !important;
        }

        /* Fill mode — override MDEditor's internal layout so the textarea
           actually stretches to the full container height. Without these
           rules MDEditor's outer .w-md-editor uses an inline pixel height
           and its internal .w-md-editor-content uses height: 100% but
           .w-md-editor-area / .w-md-editor-text have no defined size, so
           the textarea (position: absolute; height: 100%) only fills the
           default minHeight (~100px). We force every inner wrapper to be
           a flex-stretched column so the absolute textarea finally has a
           grandparent with a real height to fill. */
        .opcify-md-fill > .w-md-editor {
          flex: 1 1 0% !important;
          height: auto !important;
          max-height: none !important;
          min-height: 0 !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .opcify-md-fill .w-md-editor-content {
          flex: 1 1 0% !important;
          height: auto !important;
          min-height: 0 !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .opcify-md-fill .w-md-editor-area {
          flex: 1 1 0% !important;
          min-height: 0 !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .opcify-md-fill .w-md-editor-text {
          flex: 1 1 0% !important;
          min-height: 0 !important;
          height: auto !important;
        }
      `}</style>
    </div>
  );
}
