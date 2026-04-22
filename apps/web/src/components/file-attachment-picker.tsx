"use client";

import { useRef } from "react";
import type { ChatAttachment } from "@opcify/core";
import { Paperclip, X } from "lucide-react";

type PendingFile = {
  file: File;
  preview: string;
  attachment: ChatAttachment;
};

interface FileAttachmentPickerProps {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}

const ACCEPT =
  "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.py,.go,.rs,.java,.rb,.sh";

export type { PendingFile };

export function FileAttachmentPicker({
  files,
  onChange,
  maxFiles = 5,
  disabled,
}: FileAttachmentPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;

    const newFiles: PendingFile[] = [];
    for (const file of Array.from(selected)) {
      if (files.length + newFiles.length >= maxFiles) break;
      const data = await fileToBase64(file);
      const isImage = file.type.startsWith("image/");
      newFiles.push({
        file,
        preview: isImage ? `data:${file.type};base64,${data}` : "",
        attachment: {
          type: isImage ? "image" : "file",
          mediaType: file.type || "application/octet-stream",
          fileName: file.name,
          data,
        },
      });
    }
    onChange([...files, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div>
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {files.map((f, i) => (
            <div key={i} className="group relative shrink-0">
              {f.file.type.startsWith("image/") ? (
                <img
                  src={f.preview}
                  alt={f.file.name}
                  className="h-14 w-14 rounded-lg object-cover border border-zinc-800"
                />
              ) : (
                <div className="flex h-14 w-24 flex-col items-center justify-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950 px-2">
                  <span className="text-[10px] font-medium text-emerald-400 uppercase">
                    {f.file.name.split(".").pop()}
                  </span>
                  <span className="w-full truncate text-center text-[10px] text-zinc-500">
                    {f.file.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attach button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || files.length >= maxFiles}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Paperclip className="h-3.5 w-3.5" />
        Attach Files
        {files.length > 0 && (
          <span className="text-zinc-600">({files.length}/{maxFiles})</span>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
