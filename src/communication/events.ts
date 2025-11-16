// ABOUTME: Event type definitions for VouchAI's agent communication system
// ABOUTME: Defines all event types and payloads for agent-to-agent messaging and state synchronization

/**
 * Core event types for the VouchAI agent communication system.
 * These events represent the key state transitions in the hiring-worker-arbitrator workflow.
 */
export type EventType =
  | 'JOB_CREATED'
  | 'JOB_ACCEPTED'
  | 'WORK_SUBMITTED'
  | 'WORK_APPROVED'
  | 'DISPUTE_FILED'
  | 'ARBITRATION_COMPLETE'
  | 'PAYMENT_RELEASED';

/**
 * Agent types in the VouchAI system.
 */
export type AgentType = 'hiring' | 'worker' | 'arbitrator';

/**
 * Event processing status.
 */
export type EventStatus = 'pending' | 'processed';

/**
 * Base event interface that all specific events extend.
 * Provides common fields for tracking, routing, and processing events.
 */
export interface BaseEvent {
  /** Unique event identifier in format: event-{timestamp}-{uuid} */
  id: string;

  /** Type of event being transmitted */
  type: EventType;

  /** ISO timestamp when the event was created */
  timestamp: string;

  /** Agent that originated this event */
  sourceAgent: AgentType;

  /** Optional target agent for directed messages */
  targetAgent?: AgentType;

  /** Event-specific payload data */
  payload: Record<string, any>;

  /** List of agent IDs that have processed this event (prevents duplicate processing) */
  processedBy: string[];

  /** Current processing status of the event */
  status: EventStatus;
}

/**
 * Event emitted when a hiring agent creates a new job.
 * Signals to worker agents that a new opportunity is available.
 */
export interface JobCreatedEvent extends BaseEvent {
  type: 'JOB_CREATED';
  sourceAgent: 'hiring';
  payload: {
    /** Unique identifier for the job */
    jobId: string;

    /** Budget allocated for the job in USD */
    budget: number;

    /** Job requirements and specifications */
    requirements: string;
  };
}

/**
 * Event emitted when a worker agent accepts a job.
 * Notifies the hiring agent that work will begin.
 */
export interface JobAcceptedEvent extends BaseEvent {
  type: 'JOB_ACCEPTED';
  sourceAgent: 'worker';
  targetAgent: 'hiring';
  payload: {
    /** Job identifier being accepted */
    jobId: string;

    /** ID of the worker agent accepting the job */
    workerId: string;

    /** ISO timestamp for estimated completion */
    estimatedCompletion: string;
  };
}

/**
 * Event emitted when a worker submits completed work.
 * Triggers review by the hiring agent.
 */
export interface WorkSubmittedEvent extends BaseEvent {
  type: 'WORK_SUBMITTED';
  sourceAgent: 'worker';
  targetAgent: 'hiring';
  payload: {
    /** Job identifier for the submitted work */
    jobId: string;

    /** Unique identifier for the deliverable */
    deliverableId: string;

    /** ISO timestamp when work was submitted */
    submittedAt: string;
  };
}

/**
 * Event emitted when hiring agent approves submitted work.
 * Signals arbitrator to release payment from escrow.
 */
export interface WorkApprovedEvent extends BaseEvent {
  type: 'WORK_APPROVED';
  sourceAgent: 'hiring';
  targetAgent: 'arbitrator';
  payload: {
    /** Job identifier for the approved work */
    jobId: string;

    /** Validation score achieved (0-100) */
    validationScore: number;
  };
}

/**
 * Event emitted when either party files a dispute.
 * Triggers arbitration process and notifies the arbitrator agent.
 */
export interface DisputeFiledEvent extends BaseEvent {
  type: 'DISPUTE_FILED';
  sourceAgent: 'hiring' | 'worker';
  targetAgent: 'arbitrator';
  payload: {
    /** Job identifier under dispute */
    jobId: string;

    /** Unique identifier for the dispute */
    disputeId: string;

    /** Explanation of why the dispute was filed */
    reason: string;

    /** Supporting evidence for the dispute claim */
    evidence: string;
  };
}

/**
 * Event emitted when arbitrator completes dispute resolution.
 * Contains the final decision and financial adjustments.
 */
export interface ArbitrationCompleteEvent extends BaseEvent {
  type: 'ARBITRATION_COMPLETE';
  sourceAgent: 'arbitrator';
  payload: {
    /** Dispute identifier being resolved */
    disputeId: string;

    /** Arbitrator's final decision and reasoning */
    decision: string;

    /** Amount to be refunded to hiring agent (if any) */
    refundAmount: number;

    /** Penalty amount assessed (if any) */
    penaltyAmount: number;

    /** Updated reputation scores for involved parties */
    newReputation: {
      hiringAgent?: number;
      workerAgent?: number;
    };
  };
}

/**
 * Event emitted when payment is released to a recipient.
 * Confirms successful financial transaction.
 */
export interface PaymentReleasedEvent extends BaseEvent {
  type: 'PAYMENT_RELEASED';
  sourceAgent: 'hiring' | 'arbitrator';
  payload: {
    /** Job identifier for the payment */
    jobId: string;

    /** Amount being paid in USD */
    amount: number;

    /** Agent receiving the payment */
    recipientAgent: AgentType;
  };
}

/**
 * Union type of all specific event types.
 * Use this for type-safe event handling.
 */
export type VouchAIEvent =
  | JobCreatedEvent
  | JobAcceptedEvent
  | WorkSubmittedEvent
  | WorkApprovedEvent
  | DisputeFiledEvent
  | ArbitrationCompleteEvent
  | PaymentReleasedEvent;

/**
 * Type guard to check if an event is a specific type.
 * @param event - Event to check
 * @param type - Expected event type
 * @returns True if event matches the specified type
 */
export function isEventType<T extends VouchAIEvent>(
  event: BaseEvent,
  type: EventType
): event is T {
  return event.type === type;
}

/**
 * Helper function to create a properly formatted event ID.
 * @returns Event ID in format: event-{timestamp}-{uuid}
 */
export function generateEventId(): string {
  const timestamp = Date.now();
  const uuid = crypto.randomUUID();
  return `event-${timestamp}-${uuid}`;
}
