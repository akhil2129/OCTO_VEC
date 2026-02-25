/**
 * Business Analyst domain tools — template scaffolds for the LLM to populate.
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export const baTools: AgentTool[] = [
  {
    name: "analyze_requirements",
    label: "Analyze Requirements",
    description: "Analyze business requirements and break them down into a structured format.",
    parameters: Type.Object({
      requirement_text: Type.String({ description: "The business requirement to analyze" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "ba", params.task_id ?? "", "BA analyzing requirements");
      return ok(`## REQUIREMENT ANALYSIS

**Original Requirement:** ${params.requirement_text}

### 1. OBJECTIVE
- **What**: [Core goal to be achieved]
- **Why**: [Business value/justification]

### 2. STAKEHOLDERS
- **Primary**: [Direct beneficiaries]
- **Secondary**: [Indirect stakeholders]

### 3. ACCEPTANCE CRITERIA
- Given [initial context/state]
- When [action/trigger]
- Then [expected outcome]

### 4. DEPENDENCIES
- Technical: [Systems/APIs/Infrastructure]
- Business: [Processes/Teams/Data]

### 5. RISKS & ASSUMPTIONS
- Risks: [Potential blockers]
- Assumptions: [What we're assuming is true]

### 6. SUCCESS METRICS
- KPIs: [How we'll measure success]`);
    },
  },

  {
    name: "create_user_story",
    label: "Create User Story",
    description: "Convert a feature description into proper user stories with acceptance criteria.",
    parameters: Type.Object({
      feature_description: Type.String({ description: "Description of the feature" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "ba", params.task_id ?? "", "BA creating user story");
      return ok(`## USER STORY

**Based on:** ${params.feature_description}

**As a** [user type],
**I want to** [action/feature],
**So that** [benefit/value].

### Acceptance Criteria:

**Scenario 1: Happy Path**
- Given [initial state]
- When [user action]
- Then [expected result]

**Scenario 2: Edge Case**
- Given [different state]
- When [user action]
- Then [expected handling]

### Definition of Done:
- [ ] Functionality implemented and tested
- [ ] Code reviewed and merged
- [ ] Documentation updated
- [ ] QA sign-off received

**Story Points:** [To be estimated]
**Priority:** [To be defined]`);
    },
  },

  {
    name: "perform_gap_analysis",
    label: "Perform Gap Analysis",
    description: "Identify gaps between current state and desired future state.",
    parameters: Type.Object({
      current_state: Type.String({ description: "Description of the current state/situation" }),
      desired_state: Type.String({ description: "Description of the desired future state" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "ba", params.task_id ?? "", "BA performing gap analysis");
      return ok(`## GAP ANALYSIS

**Current State:** ${params.current_state}
**Desired State:** ${params.desired_state}

### GAPS IDENTIFIED

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| [Gap 1] | High/Med/Low | High/Med/Low | P1/P2/P3 |
| [Gap 2] | High/Med/Low | High/Med/Low | P1/P2/P3 |

### RECOMMENDED ACTIONS
1. **[Action 1]** — Owner: [Team/Agent], Timeline: [Estimate]
2. **[Action 2]** — Owner: [Team/Agent], Timeline: [Estimate]

### RISKS OF NOT CLOSING GAPS
- [Risk if gap remains]

### SUCCESS METRICS
- [KPI 1]: [Target value]
- [KPI 2]: [Target value]`);
    },
  },

  {
    name: "define_kpis",
    label: "Define KPIs",
    description: "Define measurable KPIs and success metrics for a project or feature.",
    parameters: Type.Object({
      project_description: Type.String({ description: "Project or feature to define KPIs for" }),
      task_id: Type.Optional(Type.String({ description: "Optional ATP task ID for tracking" })),
    }),
    execute: async (_, params: any) => {
      EventLog.log(EventType.AGENT_TOOL_CALL, "ba", params.task_id ?? "", "BA defining KPIs");
      return ok(`## KPI DEFINITION

**Project:** ${params.project_description}

### KEY PERFORMANCE INDICATORS

| KPI | Description | Measurement Method | Target | Baseline | Frequency |
|-----|-------------|-------------------|--------|----------|-----------|
| [KPI 1] | [What it measures] | [How measured] | [Target] | [Current] | [Daily/Weekly] |
| [KPI 2] | [What it measures] | [How measured] | [Target] | [Current] | [Daily/Weekly] |

### LEADING INDICATORS (Predictive)
- [Indicator 1]: Predicts [outcome]
- [Indicator 2]: Predicts [outcome]

### LAGGING INDICATORS (Outcome)
- [Indicator 1]: Measures [result]

### REPORTING DASHBOARD
- Tool: [Analytics platform]
- Refresh: [Frequency]
- Stakeholders: [Who receives reports]`);
    },
  },
];
