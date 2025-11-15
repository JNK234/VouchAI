// ABOUTME: Base class for VouchAI agents to integrate with the EventBus system
// ABOUTME: Provides common event handling patterns, subscription management, and agent lifecycle methods

import { EventBus } from './EventBus.js';
import { BaseEvent, EventType, VouchAIEvent, AgentType } from './events.js';
import { randomUUID } from 'crypto';

/**
 * Abstract base class for VouchAI agents to subscribe to and publish events.
 *
 * This class provides:
 * - Automatic EventBus initialization and lifecycle management
 * - Helper methods for publishing events with automatic sourceAgent assignment
 * - Event ID generation utilities
 * - Polling lifecycle (start/stop) for event consumption
 *
 * Usage Pattern:
 * 1. Extend this class (e.g., HiringAgent, WorkerAgent, ArbitratorAgent)
 * 2. Implement setupEventHandlers() to register event subscriptions
 * 3. Call startEventListener() to begin processing events
 * 4. Use publishEvent() to send events to other agents
 * 5. Call stopEventListener() when shutting down
 *
 * @example
 * ```typescript
 * class HiringAgent extends AgentSubscriber {
 *   constructor(agentId: string) {
 *     super('hiring', agentId);
 *   }
 *
 *   protected setupEventHandlers(): void {
 *     this.eventBus.subscribe('JOB_ACCEPTED', this.handleJobAccepted.bind(this));
 *   }
 *
 *   private async handleJobAccepted(event: BaseEvent): Promise<void> {
 *     // Handle the event
 *   }
 * }
 * ```
 */
export abstract class AgentSubscriber {
  /** EventBus instance for this agent */
  protected eventBus: EventBus;

  /** Type of agent (hiring, worker, or arbitrator) */
  protected agentType: AgentType;

  /** Unique identifier for this agent instance */
  protected agentId: string;

  /**
   * Initialize the agent subscriber with EventBus integration.
   *
   * @param agentType - Type of agent (hiring, worker, or arbitrator)
   * @param agentId - Unique identifier for this agent instance
   * @param marketplaceRoot - Root directory for marketplace data (defaults to './src/marketplace')
   */
  constructor(agentType: AgentType, agentId: string, marketplaceRoot: string = './src/marketplace') {
    this.agentType = agentType;
    this.agentId = agentId;
    this.eventBus = new EventBus(agentId, marketplaceRoot);

    // Subclasses must implement this to register their event handlers
    this.setupEventHandlers();
  }

  /**
   * Start listening for events by initiating the EventBus polling mechanism.
   * This should be called after the agent is initialized and ready to process events.
   *
   * @returns Promise that resolves when polling has started
   */
  public async startEventListener(): Promise<void> {
    await this.eventBus.startPolling();
    console.log(`🎧 [${this.agentType.toUpperCase()}] agent listening for events...`);
  }

  /**
   * Stop listening for events and halt the EventBus polling mechanism.
   * This should be called during agent shutdown or when pausing event processing.
   */
  public stopEventListener(): void {
    this.eventBus.stopPolling();
    console.log(`🔇 [${this.agentType.toUpperCase()}] agent stopped listening`);
  }

  /**
   * Publish an event to the EventBus for consumption by other agents.
   * Automatically sets the sourceAgent field to match this agent's type.
   *
   * @param event - Event to publish (sourceAgent will be overridden)
   * @returns Promise that resolves when the event has been published
   */
  protected async publishEvent(event: BaseEvent): Promise<void> {
    // Override sourceAgent to ensure it matches this agent's type
    event.sourceAgent = this.agentType;

    await this.eventBus.publish(event);
  }

  /**
   * Generate a unique event ID in the format: event-{timestamp}-{uuid}
   *
   * @returns Unique event identifier
   */
  protected generateEventId(): string {
    return `event-${Date.now()}-${randomUUID()}`;
  }

  /**
   * Abstract method that subclasses must implement to register their event handlers.
   * This is called during construction to set up event subscriptions.
   *
   * Typical implementation:
   * ```typescript
   * protected setupEventHandlers(): void {
   *   this.eventBus.subscribe('EVENT_TYPE', this.handleEvent.bind(this));
   * }
   * ```
   */
  protected abstract setupEventHandlers(): void;
}
