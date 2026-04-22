"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown, Sparkles, Flag, Play, CheckCircle2, XCircle } from "lucide-react";
import type { Task, TaskExecutionStep, ExecutionMode } from "@opcify/core";
import { formatDateTime, formatDuration, formatTime, timeAgo } from "@/lib/time";
import { useTimezone } from "@/lib/use-timezone";

interface ExecutionPanelProps {
  executionMode: ExecutionMode;
  steps: TaskExecutionStep[];
  task: Pick<Task, "createdAt" | "startedAt" | "finishedAt" | "status">;
}

function StepStatusDot({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-400" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800">
      <span className="h-2 w-2 rounded-full bg-zinc-600" />
    </span>
  );
}

function StepStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-400",
    running: "bg-blue-500/10 text-blue-400",
    failed: "bg-red-500/10 text-red-400",
    pending: "bg-zinc-800 text-zinc-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  );
}


/** Personified step tracker — each step is an agent avatar node connected by a path */
function StepTracker({ steps }: { steps: TaskExecutionStep[] }) {
  const total = steps.length;
  if (total === 0) return null;

  return (
    <div className="mb-6 flex items-start">
      {steps.map((step, i) => {
        const isCompleted = step.status === "completed";
        const isRunning = step.status === "running";
        const isFailed = step.status === "failed";

        return (
          <div key={step.id} className="flex flex-1 flex-col items-center">
            {/* Top row: connector line + avatar */}
            <div className="flex w-full items-center">
              {/* Left connector */}
              {i > 0 && (
                <div
                  className={`h-0.5 flex-1 transition-all duration-700 ${
                    isCompleted || isRunning || isFailed
                      ? isCompleted
                        ? "bg-amber-400"
                        : isFailed
                          ? "bg-rose-400"
                          : "bg-amber-400/50"
                      : "bg-zinc-800"
                  }`}
                />
              )}
              {i === 0 && <div className="flex-1" />}

              {/* Agent robot avatar */}
              <div className="relative">
                {/* Glow ring for running state */}
                {isRunning && (
                  <span className="absolute -inset-2 rounded-lg bg-amber-400/15 animate-[pulse-glow_2s_ease-in-out_infinite]" />
                )}
                <div
                  className={`relative z-10 flex h-10 w-10 flex-col items-center justify-center transition-all duration-500 ${
                    isCompleted
                      ? "text-amber-400"
                      : isRunning
                        ? "text-amber-300"
                        : isFailed
                          ? "text-rose-400"
                          : "text-zinc-600"
                  }`}
                >
                  {/* Robot head */}
                  <div className={`relative flex h-[22px] w-7 items-center justify-center rounded-md border-[1.5px] ${
                    isCompleted
                      ? "border-amber-400 bg-amber-400/20"
                      : isRunning
                        ? "border-amber-400 bg-amber-400/10"
                        : isFailed
                          ? "border-rose-400 bg-rose-400/10"
                          : "border-zinc-700 bg-zinc-900"
                  }`}>
                    {/* Eyes */}
                    {isCompleted ? (
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <path d="M2 5L5 8L12 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : isFailed ? (
                      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                        <path d="M3 3L6 6M6 3L3 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <path d="M9 3L6 6M6 3L9 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <div className="flex items-center gap-[5px]">
                        <span className={`block h-[5px] w-[5px] rounded-full ${
                          isRunning ? "bg-amber-300 animate-pulse" : "bg-current"
                        }`} />
                        <span className={`block h-[5px] w-[5px] rounded-full ${
                          isRunning ? "bg-amber-300 animate-pulse" : "bg-current"
                        }`} />
                      </div>
                    )}
                    {/* Antenna */}
                    <div className={`absolute -top-[5px] left-1/2 -translate-x-1/2 h-[5px] w-px ${
                      isCompleted ? "bg-amber-400" : isRunning ? "bg-amber-400" : isFailed ? "bg-rose-400" : "bg-zinc-700"
                    }`} />
                    <div className={`absolute -top-[7px] left-1/2 -translate-x-1/2 h-[3px] w-[3px] rounded-full ${
                      isCompleted ? "bg-amber-400" : isRunning ? "bg-amber-300 animate-pulse" : isFailed ? "bg-rose-400" : "bg-zinc-700"
                    }`} />
                  </div>
                  {/* Robot body */}
                  <div className={`mt-[2px] h-[10px] w-5 rounded-b-md border-[1.5px] border-t-0 ${
                    isCompleted
                      ? "border-amber-400 bg-amber-400/20"
                      : isRunning
                        ? "border-amber-400 bg-amber-400/10"
                        : isFailed
                          ? "border-rose-400 bg-rose-400/10"
                          : "border-zinc-700 bg-zinc-900"
                  }`} />
                </div>
              </div>

              {/* Right connector */}
              {i < total - 1 && (
                <div
                  className={`h-0.5 flex-1 transition-all duration-700 ${
                    isCompleted
                      ? "bg-amber-400"
                      : "bg-zinc-800"
                  }`}
                />
              )}
              {i === total - 1 && <div className="flex-1" />}
            </div>

            {/* Label below avatar */}
            <p className={`mt-1.5 max-w-[80px] truncate text-center text-[10px] font-medium leading-tight ${
              isCompleted
                ? "text-amber-400"
                : isRunning
                  ? "text-amber-300"
                  : isFailed
                    ? "text-rose-400"
                    : "text-zinc-600"
            }`}>
              {step.agentName ?? `Step ${step.stepOrder}`}
            </p>
            {isRunning && (
              <p className="mt-0.5 text-[9px] text-amber-400/70 animate-pulse">working...</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Task-lifecycle row that shares the step-card timeline rail so the whole
 * Execution panel reads as one unified flow: Created → Started → step 1 →
 * step 2 → ... → Finished. Replaces the separate Processing timeline panel.
 */
function LifecycleRow({
  icon,
  iconBg,
  iconColor,
  label,
  timestamp,
  subtitle,
  isLast,
  railColor,
}: {
  icon: ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  timestamp: string | null;
  subtitle?: string | null;
  isLast?: boolean;
  railColor: string;
}) {
  const timezone = useTimezone();
  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}
        >
          {icon}
        </span>
        {!isLast && <div className={`mt-1 w-px flex-1 ${railColor}`} />}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-300">{label}</span>
          {timestamp && (
            <span
              className="text-[11px] text-zinc-500 tabular-nums"
              title={formatDateTime(timestamp, timezone)}
            >
              {formatDateTime(timestamp, timezone)} · {timeAgo(timestamp)}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 text-xs text-zinc-600">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function StepCard({ step, isLast }: { step: TaskExecutionStep; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const timezone = useTimezone();
  const duration = formatDuration(step.startedAt, step.finishedAt);
  const isRunning = step.status === "running";
  const isPending = step.status === "pending";

  return (
    <div className="relative flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <StepStatusDot status={step.status} />
        {!isLast && (
          <div className={`mt-1 w-px flex-1 ${
            step.status === "completed" ? "bg-emerald-500/20" :
            isRunning ? "bg-blue-500/20" :
            "bg-zinc-800"
          }`} />
        )}
      </div>

      {/* Step content */}
      <div className={`min-w-0 flex-1 pb-6 ${isPending ? "opacity-50" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${
                isRunning ? "text-blue-300" :
                step.status === "failed" ? "text-red-300" :
                isPending ? "text-zinc-500" :
                "text-zinc-200"
              }`}>
                {step.title || `Step ${step.stepOrder}`}
              </span>
              <StepStatusBadge status={step.status} />
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
              {step.agentName && (
                <span className="inline-flex items-center gap-1">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-zinc-800 text-[8px] font-medium text-zinc-400">
                    {step.agentName.charAt(0)}
                  </span>
                  {step.agentName}
                </span>
              )}
              {step.roleLabel && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-600">{step.roleLabel}</span>
                </>
              )}
              {duration && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-zinc-600">{duration}{isRunning ? " (running)" : ""}</span>
                </>
              )}
              {step.startedAt && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span
                    className="text-zinc-600"
                    title={`Started ${formatDateTime(step.startedAt, timezone)}`}
                  >
                    started at {formatTime(step.startedAt, timezone)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {step.outputSummary && (
          <div className="mt-2">
            <p className="text-xs leading-relaxed text-zinc-400">
              {step.outputSummary}
            </p>
          </div>
        )}

        {step.outputContent && (
          <div className="mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
            >
              {expanded ? <>Hide details <ChevronUp className="inline h-3 w-3" /></> : <>Show details <ChevronDown className="inline h-3 w-3" /></>}
            </button>
            {expanded && (
              <div className="mt-2 max-h-64 overflow-auto rounded-md bg-zinc-950 p-3">
                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">
                  {step.outputContent}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ExecutionPanel({ executionMode, steps, task }: ExecutionPanelProps) {
  if (steps.length === 0) return null;

  const completed = steps.filter((s) => s.status === "completed").length;
  const running = steps.filter((s) => s.status === "running");
  const total = steps.length;

  const modeLabel = executionMode === "orchestrated" ? "Auto Orchestrated" : "Manual Workflow";
  const modeSubtitle = executionMode === "orchestrated"
    ? "Coordinated by Orchestrator Agent"
    : "User-defined workflow";

  const isTerminal =
    task.status === "done" || task.status === "failed" || task.status === "stopped";
  const queueWait = formatDuration(task.createdAt, task.startedAt);
  const execDuration = formatDuration(task.startedAt, task.finishedAt);
  const runningFor = formatDuration(task.startedAt, null);

  return (
    <section className="mt-6 rounded-xl border border-violet-500/15 bg-violet-500/[0.02] p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-500/15 text-violet-400"><Sparkles className="h-3.5 w-3.5" /></span>
            Execution
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">{modeLabel} · {modeSubtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-zinc-300">
            {completed}/{total} steps
          </p>
          {running.length > 0 && running[0].agentName && (
            <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-blue-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              {running[0].agentName}
            </p>
          )}
        </div>
      </div>

      {/* Animated step tracker */}
      <StepTracker steps={steps} />

      {/* Unified timeline — task lifecycle + per-step detail in one flow */}
      <div>
        <LifecycleRow
          icon={<Flag className="h-3 w-3" />}
          iconBg="bg-zinc-800"
          iconColor="text-zinc-400"
          label="Created"
          timestamp={task.createdAt}
          railColor="bg-zinc-800"
        />

        {task.startedAt && (
          <LifecycleRow
            icon={<Play className="h-3 w-3" />}
            iconBg="bg-blue-500/15"
            iconColor="text-blue-400"
            label="Started execution"
            timestamp={task.startedAt}
            subtitle={
              queueWait
                ? `Queued for ${queueWait}`
                : undefined
            }
            railColor="bg-blue-500/20"
          />
        )}

        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            isLast={i === steps.length - 1 && isTerminal === false}
          />
        ))}

        {isTerminal && task.finishedAt && (
          <LifecycleRow
            icon={
              task.status === "failed" || task.status === "stopped" ? (
                <XCircle className="h-3 w-3" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )
            }
            iconBg={
              task.status === "failed" || task.status === "stopped"
                ? "bg-red-500/15"
                : "bg-emerald-500/15"
            }
            iconColor={
              task.status === "failed" || task.status === "stopped"
                ? "text-red-400"
                : "text-emerald-400"
            }
            label={
              task.status === "failed"
                ? "Failed"
                : task.status === "stopped"
                  ? "Stopped"
                  : "Finished"
            }
            timestamp={task.finishedAt}
            subtitle={execDuration ? `Execution took ${execDuration}` : undefined}
            isLast
            railColor="bg-zinc-800"
          />
        )}

        {!isTerminal && runningFor && task.startedAt && (
          <LifecycleRow
            icon={<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />}
            iconBg="bg-blue-500/15"
            iconColor="text-blue-400"
            label={`Running for ${runningFor}`}
            timestamp={null}
            isLast
            railColor="bg-zinc-800"
          />
        )}
      </div>
    </section>
  );
}
