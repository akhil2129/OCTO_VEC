/**
 * Senior Developer domain tools — template scaffolds for the LLM to populate.
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export const devTools: AgentTool[] = [
  {
    name: "write_code",
    label: "Write Code",
    description: "Write code for a given feature or functionality description.",
    parameters: Type.Object({
      description: Type.String({ description: "What code needs to be written" }),
      language: Type.Optional(Type.String({ description: "Programming language (default: python)" })),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      const lang = params.language ?? "python";
      EventLog.log(EventType.AGENT_TOOL_CALL, "dev", params.task_id ?? "", "Dev writing code");
      return ok(`## CODE IMPLEMENTATION

**Task:** ${params.description}
**Language:** ${lang}

### Implementation Plan:
1. Understand the requirements and scope
2. Design the solution architecture
3. Write clean, modular code with proper separation of concerns
4. Add necessary error handling and input validation
5. Write inline documentation/comments for complex logic

### Code Structure:
\`\`\`${lang}
# [Implementation would go here based on the actual requirements]
# Following best practices:
# - Single responsibility principle
# - DRY (Don't Repeat Yourself)
# - Proper error handling
# - Type hints (for Python) / TypeScript types
# - Meaningful variable/function names
\`\`\`

### Key Considerations:
- Edge cases handled
- Input validation included
- Error messages are descriptive
- Performance optimized where needed`);
    },
  },

  {
    name: "review_code",
    label: "Review Code",
    description: "Review code for quality, bugs, and best practices.",
    parameters: Type.Object({
      code_snippet: Type.String({ description: "The code to review" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "dev", params.task_id ?? "", "Dev reviewing code");
      const preview = params.code_snippet.length > 500
        ? params.code_snippet.slice(0, 500) + "..."
        : params.code_snippet;
      return ok(`## CODE REVIEW REPORT

**Code Reviewed:**
\`\`\`
${preview}
\`\`\`

### Review Categories:

#### 1. Correctness
- Logic errors: [Check for off-by-one errors, wrong conditions]
- Edge cases: [Null/empty inputs, boundary values]
- Error handling: [Exceptions caught and handled properly]

#### 2. Code Quality
- Readability: [Naming conventions, code clarity]
- Maintainability: [Modular structure, single responsibility]
- DRY compliance: [No unnecessary duplication]

#### 3. Performance
- Time complexity: [Algorithmic efficiency]
- Memory usage: [Unnecessary allocations]
- Database queries: [N+1 problems, missing indexes]

#### 4. Security
- Input sanitization: [SQL injection, XSS vulnerabilities]
- Secrets management: [No hardcoded credentials]
- Authentication checks: [Proper access control]

### Summary:
- **Critical Issues:** [List any blocking issues]
- **Suggestions:** [Non-blocking improvements]
- **Verdict:** [Approve / Request Changes]`);
    },
  },

  {
    name: "debug_issue",
    label: "Debug Issue",
    description: "Analyze and debug a reported issue or error.",
    parameters: Type.Object({
      error_description: Type.String({ description: "Description of the bug or error" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "dev", params.task_id ?? "", "Dev debugging issue");
      return ok(`## DEBUG ANALYSIS

**Issue:** ${params.error_description}

### 1. ROOT CAUSE ANALYSIS
- **Immediate Cause:** [What directly triggered the error]
- **Root Cause:** [Underlying design/logic issue]
- **Contributing Factors:** [Environment, configuration, data]

### 2. REPRODUCTION STEPS
1. [Setup: environment, state]
2. [Trigger action]
3. [Observe error]

### 3. IMPACT ASSESSMENT
- **Severity:** [Critical / High / Medium / Low]
- **Affected Users:** [Scope of impact]
- **Data Loss Risk:** [Yes / No]

### 4. FIX APPROACH
\`\`\`
# Proposed fix:
# [Description of the code change needed]
\`\`\`

### 5. PREVENTION
- [How to prevent this class of bug in future]
- [Tests to add]

### 6. TESTING VERIFICATION
- [ ] Unit test covers the fix
- [ ] Edge cases tested
- [ ] Regression test added`);
    },
  },

  {
    name: "refactor_code",
    label: "Refactor Code",
    description: "Propose and implement code refactoring for better structure and maintainability.",
    parameters: Type.Object({
      code_description: Type.String({ description: "Description of the code to refactor and why" }),
      refactoring_goals: Type.Optional(Type.String({ description: "Specific goals: readability, performance, testability, etc." })),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "dev", params.task_id ?? "", "Dev refactoring code");
      return ok(`## REFACTORING PLAN

**Code:** ${params.code_description}
**Goals:** ${params.refactoring_goals ?? "Improve structure and maintainability"}

### CURRENT ISSUES
- [Issue 1: e.g., Long method, does too many things]
- [Issue 2: e.g., Magic numbers, poor naming]
- [Issue 3: e.g., Duplicated logic]

### REFACTORING APPROACH

#### Step 1: [First change]
- Before: [Current pattern]
- After: [Improved pattern]
- Reason: [Why this is better]

#### Step 2: [Second change]
- Before: [Current pattern]
- After: [Improved pattern]

### SAFETY CHECKLIST
- [ ] All existing tests still pass
- [ ] No behavior changes (pure refactor)
- [ ] New tests added for newly separated functions
- [ ] Code reviewed before merge

### EXPECTED OUTCOMES
- Readability: [Better/Same]
- Performance: [Better/Same/Note tradeoffs]
- Testability: [Better/Same]`);
    },
  },
];
