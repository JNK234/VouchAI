// ABOUTME: Type definitions for orchestrator
// ABOUTME: Shared types for job workflow state and conversation management

import { EventType } from '../../communication/events.js';

export interface JobWorkflowState {
  jobId: string;
  description: string;
  budget: number;
  requirements: string[];
  status: 'created' | 'accepted' | 'submitted' | 'validated' | 'resolved' | 'disputed';
  startTime: number;
  events: Array<{ type: EventType; timestamp: string; details: any }>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
