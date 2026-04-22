import { describe, expect, it } from "vitest";
import { syncExecutionStepsBody } from "./schemas";

describe("syncExecutionStepsBody", () => {
  describe(".strict() guardrails", () => {
    it("rejects unknown top-level fields (e.g. executionSteps typo)", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionSteps: [
          { stepOrder: 1, agentName: "Researcher", title: "x", status: "pending" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain("executionSteps");
      }
    });

    it("rejects unknown per-step fields (stepId, name, description)", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        steps: [
          {
            stepId: "research",
            stepOrder: 1,
            name: "Research competitors",
            description: "whatever",
            status: "pending",
          },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toMatch(/stepId|name|description/);
      }
    });
  });

  describe("orchestrated-mode required fields", () => {
    it("requires agentName per step when executionMode is 'orchestrated'", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        steps: [
          { stepOrder: 1, title: "Research competitors", status: "pending" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain("agentName");
        expect(msg).toContain("orchestrated");
      }
    });

    it("requires title per step when executionMode is 'orchestrated'", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        steps: [
          { stepOrder: 1, agentName: "Researcher", status: "pending" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain("title");
        expect(msg).toContain("orchestrated");
      }
    });

    it("accepts a valid orchestrated plan callback", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        steps: [
          { stepOrder: 1, agentName: "Researcher", title: "Research", status: "pending" },
          { stepOrder: 2, agentName: "Executor", title: "Write", status: "pending" },
          { stepOrder: 3, agentName: "Reviewer", title: "Review", status: "pending" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid orchestrated FINAL callback with outputContent on the last step", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        finalTaskStatus: "done",
        steps: [
          { stepOrder: 1, agentName: "Researcher", title: "Research", status: "completed", outputSummary: "done" },
          { stepOrder: 2, agentName: "Executor", title: "Write", status: "completed", outputSummary: "done" },
          {
            stepOrder: 3,
            agentName: "Reviewer",
            title: "Review",
            status: "completed",
            outputSummary: "APPROVED",
            outputContent: "# Full report body\n\nLong deliverable here.",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects outputContent at the TOP LEVEL (common mistake)", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        finalTaskStatus: "done",
        outputContent: "Full report here",
        steps: [
          { stepOrder: 1, agentName: "Researcher", title: "Research", status: "completed", outputSummary: "done" },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain("outputContent");
      }
    });

    it("rejects resultContent as a per-step field (common mistake)", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "orchestrated",
        finalTaskStatus: "done",
        steps: [
          {
            stepOrder: 1,
            agentName: "Researcher",
            title: "Research",
            status: "completed",
            outputSummary: "done",
            resultContent: "Should be outputContent",
          },
        ],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = JSON.stringify(result.error.issues);
        expect(msg).toContain("resultContent");
      }
    });
  });

  describe("single-step mode stays permissive", () => {
    it("does NOT require agentName/title when executionMode is 'single'", () => {
      const result = syncExecutionStepsBody.safeParse({
        executionMode: "single",
        finalTaskStatus: "done",
        steps: [
          { stepOrder: 1, status: "completed", outputSummary: "ok" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("does NOT require agentName/title when executionMode is omitted", () => {
      const result = syncExecutionStepsBody.safeParse({
        steps: [
          { stepOrder: 1, status: "pending" },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts the empty-steps probe used by the workspace-scope test", () => {
      const result = syncExecutionStepsBody.safeParse({ steps: [] });
      expect(result.success).toBe(true);
    });
  });
});
