// ABOUTME: EventBus class for VouchAI's file-based event communication system
// ABOUTME: Implements publish-subscribe pattern with polling, atomic writes, and idempotency tracking

import { BaseEvent, EventType, generateEventId } from './events.js';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Event handler function type.
 * Handlers are async functions that process events.
 */
export type EventHandler = (event: BaseEvent) => Promise<void>;

/**
 * EventBus - File-based event communication system for multi-agent coordination.
 *
 * Design Pattern:
 * - File-based publish-subscribe for inter-agent communication
 * - Polling-based event consumption (every 5 seconds)
 * - Atomic writes using temp files to prevent race conditions
 * - Idempotency via processedBy tracking array
 * - Auto-archival when all agents have processed an event
 *
 * Directory Structure:
 * - src/marketplace/events/pending/   - Events waiting to be processed
 * - src/marketplace/events/processed/ - Archived events after all agents process
 *
 * Event Lifecycle:
 * 1. Agent publishes event → written to pending/
 * 2. Other agents poll pending/ directory
 * 3. Each agent processes and adds their ID to processedBy[]
 * 4. When all 3 agents processed → moved to processed/
 */
export class EventBus {
  private eventsDir: string;
  private pendingDir: string;
  private processedDir: string;
  private handlers: Map<EventType, EventHandler[]>;
  private pollingInterval: number;
  private isPolling: boolean;
  private pollingTimer?: NodeJS.Timeout;
  private agentId: string;

  constructor(agentId: string, marketplaceRoot: string = './src/marketplace') {
    this.agentId = agentId;
    this.eventsDir = path.join(marketplaceRoot, 'events');
    this.pendingDir = path.join(this.eventsDir, 'pending');
    this.processedDir = path.join(this.eventsDir, 'processed');
    this.handlers = new Map();
    this.pollingInterval = 5000; // 5 seconds
    this.isPolling = false;

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Ensure all required directories exist.
   * Creates them if missing.
   */
  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.eventsDir, { recursive: true });
      await fs.mkdir(this.pendingDir, { recursive: true });
      await fs.mkdir(this.processedDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create event directories:', error);
      throw error;
    }
  }

  /**
   * Publish an event to the pending directory.
   * Uses atomic write pattern (write to temp file, then rename).
   *
   * @param event - Event to publish (id and timestamp will be auto-generated if missing)
   */
  async publish(event: BaseEvent): Promise<void> {
    try {
      // Generate event ID if not provided
      if (!event.id) {
        event.id = generateEventId();
      }

      // Add timestamp if not provided
      if (!event.timestamp) {
        event.timestamp = new Date().toISOString();
      }

      // Initialize processedBy array if not present
      if (!event.processedBy) {
        event.processedBy = [];
      }

      // Initialize status if not present
      if (!event.status) {
        event.status = 'pending';
      }

      const eventFileName = `${event.id}.json`;
      const eventFilePath = path.join(this.pendingDir, eventFileName);
      const tempFilePath = path.join(this.pendingDir, `.${event.id}.tmp`);

      // Write to temp file first (atomic write pattern)
      await fs.writeFile(tempFilePath, JSON.stringify(event, null, 2), 'utf-8');

      // Rename to final location (atomic operation on most filesystems)
      await fs.rename(tempFilePath, eventFilePath);

      console.log(`[EventBus] Published event ${event.type} with ID ${event.id}`);
    } catch (error) {
      console.error('Failed to publish event:', error);
      throw error;
    }
  }

  /**
   * Subscribe to a specific event type with a handler function.
   * Multiple handlers can be registered for the same event type.
   *
   * @param eventType - Type of event to listen for
   * @param handler - Async function to handle the event
   */
  subscribe(eventType: EventType, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    this.handlers.get(eventType)!.push(handler);
    console.log(`[EventBus] Subscribed to ${eventType} events`);
  }

  /**
   * Start polling for events at the configured interval.
   * Calls poll() method every 5 seconds.
   */
  async startPolling(): Promise<void> {
    if (this.isPolling) {
      console.warn('[EventBus] Already polling, ignoring duplicate start request');
      return;
    }

    this.isPolling = true;
    console.log(`[EventBus] Started polling (interval: ${this.pollingInterval}ms)`);

    // Initial poll
    await this.poll();

    // Set up interval polling
    this.pollingTimer = setInterval(() => {
      this.poll().catch((error) => {
        console.error('[EventBus] Error during polling:', error);
      });
    }, this.pollingInterval);
  }

  /**
   * Stop polling for events.
   */
  stopPolling(): void {
    if (!this.isPolling) {
      return;
    }

    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    this.isPolling = false;
    console.log('[EventBus] Stopped polling');
  }

  /**
   * Poll the pending directory for events to process.
   *
   * Process:
   * 1. Read all files from pending directory
   * 2. Sort by timestamp (oldest first)
   * 3. For each event:
   *    - Skip if current agent already processed it
   *    - Call all registered handlers for that event type
   *    - Add current agent to processedBy array
   *    - If all 3 agents processed: move to processed directory
   *    - Otherwise: update pending file with new processedBy list
   */
  async poll(): Promise<void> {
    try {
      // Read all pending event files
      const files = await fs.readdir(this.pendingDir);

      // Filter out temp files and non-JSON files
      const eventFiles = files.filter(
        (file) => file.endsWith('.json') && !file.startsWith('.')
      );

      if (eventFiles.length === 0) {
        return; // No events to process
      }

      // Read and parse all events
      const events: BaseEvent[] = [];
      for (const file of eventFiles) {
        try {
          const filePath = path.join(this.pendingDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const event = JSON.parse(content) as BaseEvent;
          events.push(event);
        } catch (error) {
          console.error(`[EventBus] Failed to parse event file ${file}:`, error);
          continue;
        }
      }

      // Sort by timestamp (oldest first)
      events.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Process each event
      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      console.error('[EventBus] Error during poll:', error);
      throw error;
    }
  }

  /**
   * Process a single event.
   * Checks if already processed, calls handlers, and updates processedBy.
   *
   * @param event - Event to process
   */
  private async processEvent(event: BaseEvent): Promise<void> {
    try {
      // Check if current agent already processed this event
      if (event.processedBy.includes(this.agentId)) {
        return; // Already processed by this agent
      }

      // Get handlers for this event type
      const handlers = this.handlers.get(event.type) || [];

      if (handlers.length === 0) {
        // No handlers registered, still mark as processed
        console.log(
          `[EventBus] No handlers for ${event.type}, marking as processed`
        );
      } else {
        // Call all registered handlers
        console.log(`[EventBus] Processing event ${event.type} (ID: ${event.id})`);
        for (const handler of handlers) {
          try {
            await handler(event);
          } catch (error) {
            console.error(
              `[EventBus] Handler failed for event ${event.id}:`,
              error
            );
            // Continue with other handlers even if one fails
          }
        }
      }

      // Add current agent to processedBy array
      event.processedBy.push(this.agentId);

      // Check if all 3 agents have processed (hiring, worker, arbitrator)
      const allAgentsProcessed = event.processedBy.length >= 3;

      if (allAgentsProcessed) {
        // Move to processed directory
        await this.moveToProcessed(event.id);
        console.log(`[EventBus] Event ${event.id} processed by all agents, archived`);
      } else {
        // Update pending file with new processedBy list
        const eventFilePath = path.join(this.pendingDir, `${event.id}.json`);
        const tempFilePath = path.join(this.pendingDir, `.${event.id}.tmp`);

        // Atomic write
        await fs.writeFile(tempFilePath, JSON.stringify(event, null, 2), 'utf-8');
        await fs.rename(tempFilePath, eventFilePath);

        console.log(
          `[EventBus] Event ${event.id} processed by ${this.agentId} (${event.processedBy.length}/3 agents)`
        );
      }
    } catch (error) {
      console.error(`[EventBus] Failed to process event ${event.id}:`, error);
      throw error;
    }
  }

  /**
   * Move an event file from pending to processed directory.
   *
   * @param eventId - ID of the event to move
   */
  private async moveToProcessed(eventId: string): Promise<void> {
    try {
      const sourcePath = path.join(this.pendingDir, `${eventId}.json`);
      const destPath = path.join(this.processedDir, `${eventId}.json`);

      // Read the event content
      const content = await fs.readFile(sourcePath, 'utf-8');

      // Write to processed directory
      await fs.writeFile(destPath, content, 'utf-8');

      // Delete from pending directory
      await fs.unlink(sourcePath);
    } catch (error) {
      console.error(`[EventBus] Failed to move event ${eventId} to processed:`, error);
      throw error;
    }
  }

  /**
   * Get the agent ID for this EventBus instance.
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Check if currently polling.
   */
  isCurrentlyPolling(): boolean {
    return this.isPolling;
  }
}
