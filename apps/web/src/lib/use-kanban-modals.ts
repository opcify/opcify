"use client";

import { useCallback, useState } from "react";
import type { TaskWithAgent } from "@opcify/core";

export interface KanbanModalsState {
  showEntryModal: boolean;
  showCreateModal: boolean;
  showBreakDown: boolean;
  followUpTask: TaskWithAgent | null;
  toastMessage: string | null;

  openEntryModal: () => void;
  closeEntryModal: () => void;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openBreakDown: () => void;
  closeBreakDown: () => void;
  setFollowUpTask: (task: TaskWithAgent | null) => void;
  setToastMessage: (msg: string | null) => void;
}

export function useKanbanModals(): KanbanModalsState {
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBreakDown, setShowBreakDown] = useState(false);
  const [followUpTask, setFollowUpTask] = useState<TaskWithAgent | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  return {
    showEntryModal,
    showCreateModal,
    showBreakDown,
    followUpTask,
    toastMessage,
    openEntryModal: useCallback(() => setShowEntryModal(true), []),
    closeEntryModal: useCallback(() => setShowEntryModal(false), []),
    openCreateModal: useCallback(() => setShowCreateModal(true), []),
    closeCreateModal: useCallback(() => setShowCreateModal(false), []),
    openBreakDown: useCallback(() => setShowBreakDown(true), []),
    closeBreakDown: useCallback(() => setShowBreakDown(false), []),
    setFollowUpTask,
    setToastMessage,
  };
}
