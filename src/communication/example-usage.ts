// ABOUTME: Example usage of EventBus for VouchAI agent communication
// ABOUTME: Demonstrates publish-subscribe pattern with event handlers

import { EventBus } from './EventBus.js';
import { BaseEvent, JobCreatedEvent } from './events.js';

/**
 * Example: Hiring Agent Publishing Job Created Event
 */
async function examplePublish() {
  // Create EventBus for hiring agent
  const eventBus = new EventBus('hiring-agent', './marketplace');

  // Create a job created event
  const jobEvent: JobCreatedEvent = {
    id: '', // Will be auto-generated
    type: 'JOB_CREATED',
    timestamp: '', // Will be auto-generated
    sourceAgent: 'hiring',
    payload: {
      jobId: 'job-001',
      budget: 100,
      requirements: 'Build a Fibonacci calculator',
    },
    processedBy: [],
    status: 'pending',
  };

  // Publish the event
  await eventBus.publish(jobEvent);
  console.log('Job created event published!');
}

/**
 * Example: Worker Agent Subscribing to Job Events
 */
async function exampleSubscribe() {
  // Create EventBus for worker agent
  const eventBus = new EventBus('worker-agent', './marketplace');

  // Subscribe to JOB_CREATED events
  eventBus.subscribe('JOB_CREATED', async (event: BaseEvent) => {
    console.log(`[Worker] New job available!`);
    console.log(`Job ID: ${event.payload.jobId}`);
    console.log(`Budget: $${event.payload.budget}`);
    console.log(`Requirements: ${event.payload.requirements}`);

    // Worker can now decide to accept the job
    // and publish a JOB_ACCEPTED event
  });

  // Subscribe to ARBITRATION_COMPLETE events
  eventBus.subscribe('ARBITRATION_COMPLETE', async (event: BaseEvent) => {
    console.log(`[Worker] Arbitration decision received`);
    console.log(`Decision: ${event.payload.decision}`);
    console.log(`Penalty: $${event.payload.penaltyAmount}`);
    console.log(`New Reputation: ${event.payload.newReputation.workerAgent}`);
  });

  // Start polling for events
  await eventBus.startPolling();
  console.log('Worker agent listening for events...');

  // Keep process running
  // In a real application, this would be part of the agent's main loop
}

/**
 * Example: Arbitrator Agent Processing Disputes
 */
async function exampleArbitrator() {
  // Create EventBus for arbitrator agent
  const eventBus = new EventBus('arbitrator-agent', './marketplace');

  // Subscribe to DISPUTE_FILED events
  eventBus.subscribe('DISPUTE_FILED', async (event: BaseEvent) => {
    console.log(`[Arbitrator] New dispute filed!`);
    console.log(`Dispute ID: ${event.payload.disputeId}`);
    console.log(`Job ID: ${event.payload.jobId}`);
    console.log(`Reason: ${event.payload.reason}`);

    // Arbitrator would now:
    // 1. Evaluate the dispute using Claude
    // 2. Make a decision
    // 3. Publish ARBITRATION_COMPLETE event
  });

  // Start polling
  await eventBus.startPolling();
  console.log('Arbitrator agent ready to handle disputes...');
}

/**
 * Graceful shutdown example
 */
function setupGracefulShutdown(eventBus: EventBus) {
  process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    eventBus.stopPolling();
    process.exit(0);
  });
}

// Example usage:
// await examplePublish();
// await exampleSubscribe();
// await exampleArbitrator();
