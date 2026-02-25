/**
 * Core data models for the Agent Task Portal (ATP).
 */

export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

export enum Priority {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum MessageType {
  STATUS_UPDATE = "status_update",
  ERROR = "error",
  INFO = "info",
}

export enum EmployeeStatus {
  AVAILABLE = "available",
  BUSY = "busy",
  OFFLINE = "offline",
}

export interface Task {
  task_id: string;
  description: string;
  agent_id: string;
  priority: Priority;
  status: TaskStatus;
  folder_access: string;
  created_at: string; // ISO string
  updated_at: string; // ISO string
  result: string;
}

export interface Message {
  from_agent: string;
  task_id: string;
  type: MessageType;
  message: string;
  timestamp: string; // ISO string
}

export interface Employee {
  employee_id: string;
  agent_id: string;
  name: string;
  designation: string;
  department: string;
  hierarchy_level: number;
  reports_to: string;
  status: EmployeeStatus;
  skills: string;
  joined_at: string; // ISO string
}

export interface AgentMessage {
  from_agent: string;
  to_agent: string;
  task_id: string;
  priority: "normal" | "priority";
  message: string;
  timestamp: string; // ISO string
}

export enum EventType {
  TASK_CREATED = "task_created",
  TASK_STARTED = "task_started",
  TASK_IN_PROGRESS = "task_in_progress",
  TASK_COMPLETED = "task_completed",
  TASK_FAILED = "task_failed",
  AGENT_THINKING = "agent_thinking",
  AGENT_TOOL_CALL = "agent_tool_call",
  PM_READING_QUEUE = "pm_reading_queue",
  PM_DELEGATING = "pm_delegating",
  MESSAGE_SENT = "message_sent",
  USER_INPUT = "user_input",
}

export interface Event {
  timestamp: string; // ISO string
  event_type: EventType;
  agent_id: string;
  task_id: string;
  message: string;
  details: string;
}
