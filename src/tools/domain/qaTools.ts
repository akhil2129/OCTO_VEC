/**
 * QA Engineer domain tools — template scaffolds for the LLM to populate.
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export const qaTools: AgentTool[] = [
  {
    name: "create_test_plan",
    label: "Create Test Plan",
    description: "Create a comprehensive test plan for a feature or system.",
    parameters: Type.Object({
      feature_description: Type.String({ description: "Feature or system to test" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "qa", params.task_id ?? "", "QA creating test plan");
      return ok(`## TEST PLAN

**Feature:** ${params.feature_description}

### 1. SCOPE
- **In Scope:** [Features/modules to be tested]
- **Out of Scope:** [Explicitly excluded areas]

### 2. TEST STRATEGY
- **Unit Tests:** Individual component testing
- **Integration Tests:** Component interaction testing
- **E2E Tests:** Full user flow testing
- **Regression Tests:** Prevent existing functionality breakage

### 3. TEST ENVIRONMENTS
- Development (dev)
- Staging (pre-prod)
- Production (smoke only)

### 4. TEST TYPES
| Type | Coverage Goal | Priority |
|------|--------------|----------|
| Functional | 90%+ | High |
| Boundary | Key inputs | High |
| Negative | Invalid inputs | Medium |
| Performance | Load scenarios | Medium |
| Security | Auth/OWASP | High |

### 5. ENTRY/EXIT CRITERIA
- **Entry:** Feature code complete, dev unit tests passing
- **Exit:** All critical/high test cases pass, no P1/P2 open bugs

### 6. RISKS
- [Risk 1 and mitigation]
- [Risk 2 and mitigation]

### 7. TIMELINE
- Test case creation: [estimate]
- Test execution: [estimate]
- Bug fix cycle: [estimate]`);
    },
  },

  {
    name: "write_test_cases",
    label: "Write Test Cases",
    description: "Write detailed test cases for a feature.",
    parameters: Type.Object({
      feature_description: Type.String({ description: "Feature to write test cases for" }),
      test_type: Type.Optional(Type.String({ description: "Type: functional, boundary, negative, performance (default: functional)" })),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      const testType = params.test_type ?? "functional";
      EventLog.log(EventType.AGENT_TOOL_CALL, "qa", params.task_id ?? "", `QA writing ${testType} test cases`);
      return ok(`## TEST CASES — ${testType.toUpperCase()}

**Feature:** ${params.feature_description}

### TC-001: Happy Path
- **Preconditions:** System in valid state, user authenticated
- **Steps:**
  1. [Step 1]
  2. [Step 2]
  3. [Step 3]
- **Expected Result:** [Expected outcome]
- **Priority:** High

### TC-002: Boundary Values
- **Preconditions:** [Setup]
- **Steps:**
  1. Test minimum valid input
  2. Test maximum valid input
  3. Test just beyond boundaries
- **Expected Result:** [Correct handling at boundaries]
- **Priority:** High

### TC-003: Negative — Invalid Input
- **Preconditions:** [Setup]
- **Steps:**
  1. Provide empty/null input
  2. Provide wrong data type
  3. Provide malformed data
- **Expected Result:** [Graceful error handling, no crash]
- **Priority:** Medium

### TC-004: Error Recovery
- **Preconditions:** System in error state
- **Steps:**
  1. Trigger error condition
  2. Verify error message shown
  3. Verify system recovers/retries correctly
- **Expected Result:** [Graceful recovery]
- **Priority:** High

### AUTOMATION NOTES
- Automatable: [Yes/No]
- Framework: [pytest / Jest / Playwright]
- Priority for automation: [High/Medium/Low]`);
    },
  },

  {
    name: "report_bug",
    label: "Report Bug",
    description: "Create a structured bug report for a discovered defect.",
    parameters: Type.Object({
      bug_description: Type.String({ description: "Description of the bug found" }),
      severity: Type.Optional(
        Type.Union([Type.Literal("critical"), Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
          description: "Bug severity (default: medium)",
        })
      ),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      const severity = params.severity ?? "medium";
      EventLog.log(EventType.AGENT_TOOL_CALL, "qa", params.task_id ?? "", `QA reporting ${severity} bug`);
      return ok(`## BUG REPORT

**Summary:** ${params.bug_description}
**Severity:** ${severity.toUpperCase()}
**Priority:** [P1/P2/P3/P4]
**Status:** Open

### ENVIRONMENT
- OS: [Operating system]
- Browser/Runtime: [Version]
- Build/Version: [App version]

### REPRODUCTION STEPS
1. [Precondition: initial state]
2. [Action taken]
3. [Observed result]

### EXPECTED vs ACTUAL
- **Expected:** [What should happen]
- **Actual:** [What actually happens]

### EVIDENCE
- Screenshot/Log: [Attach or describe]
- Error message: [Exact error text]

### IMPACT
- **Users affected:** [All / Subset / Edge case]
- **Workaround:** [Yes: describe / No]
- **Blocker:** [Yes / No]

### SUGGESTED FIX
[If known, describe the likely cause and fix approach]`);
    },
  },

  {
    name: "analyze_test_coverage",
    label: "Analyze Test Coverage",
    description: "Analyze and report on test coverage for a codebase or feature.",
    parameters: Type.Object({
      codebase_description: Type.String({ description: "Description of the codebase or feature to analyze coverage for" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "qa", params.task_id ?? "", "QA analyzing test coverage");
      return ok(`## TEST COVERAGE ANALYSIS

**Scope:** ${params.codebase_description}

### COVERAGE SUMMARY
| Area | Line Coverage | Branch Coverage | Status |
|------|--------------|-----------------|--------|
| [Module 1] | [%] | [%] | ✅/⚠️/❌ |
| [Module 2] | [%] | [%] | ✅/⚠️/❌ |

### CRITICAL GAPS (Untested paths)
1. **[Gap 1]** — Risk: High — Recommended test: [TC description]
2. **[Gap 2]** — Risk: Medium — Recommended test: [TC description]

### COVERAGE TARGETS
- Current: [X%] line, [Y%] branch
- Target: 80% line, 70% branch
- Gap to close: [Delta]

### RECOMMENDATIONS
1. [Priority 1 action to improve coverage]
2. [Priority 2 action]

### TOOLS RECOMMENDED
- Coverage: [pytest-cov / nyc / Istanbul]
- Reporting: [Codecov / Coveralls]`);
    },
  },
];
