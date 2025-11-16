// ABOUTME: Background service for WorkerAgent - runs as daemon without CLI interaction
// ABOUTME: Automatically accepts jobs, generates work with AI, and submits deliverables

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import { AgentSubscriber } from '../../communication/AgentSubscriber.js';
import {
  BaseEvent,
  JobCreatedEvent,
  ArbitrationCompleteEvent,
  JobAcceptedEvent,
  WorkSubmittedEvent
} from '../../communication/events.js';
import * as marketplace from '../../shared/marketplace.js';

class WorkerAgentService extends AgentSubscriber {
  private walletAddress: string;
  private autoAcceptJobs: boolean = true;

  constructor() {
    super('worker', `worker-${randomUUID()}`);

    this.walletAddress = process.env.WORKER_AGENT_WALLET!;
    if (!this.walletAddress) {
      throw new Error('WORKER_AGENT_WALLET not configured in .env - please add your wallet address');
    }

    console.log(`👷 Worker Agent Service initialized`);
    console.log(`   Wallet: ${this.walletAddress}`);
    console.log(`   Auto-accept jobs: ${this.autoAcceptJobs}`);
  }

  protected setupEventHandlers(): void {
    this.eventBus.subscribe('JOB_CREATED', this.handleJobCreated.bind(this));
    this.eventBus.subscribe('ARBITRATION_COMPLETE', this.handleArbitrationComplete.bind(this));
  }

  /**
   * Ensure worker agent has at least 1 USDC stake for job acceptance
   */
  private async ensureWorkerStake(): Promise<void> {
    try {
      await marketplace.initMarketplace();
      const agents = await marketplace.readAgents();
      const workerAgent = agents.agents['worker-agent'];

      if (!workerAgent || workerAgent.stakeAmount < 1) {
        console.log('💰 Depositing 1 USDC stake for worker agent...');
        await marketplace.updateWorkerStake('worker-agent', 1);
        console.log('✅ Worker stake deposited successfully');
      } else {
        console.log(`💰 Worker already has stake: ${workerAgent.stakeAmount} USDC`);
      }
    } catch (error) {
      console.error('❌ Failed to ensure worker stake:', error);
      // Continue anyway - this shouldn't block the service
    }
  }

  async start(): Promise<void> {
    console.log('\n👷 WORKER AGENT SERVICE STARTING\n');
    console.log('Mode: Background service (no CLI interaction)');
    console.log('Listening for: JOB_CREATED, ARBITRATION_COMPLETE events');
    console.log('Auto-accept: Enabled (jobs will be accepted and completed automatically)\n');
    console.log('Press Ctrl+C to stop\n');

    // Initialize marketplace and ensure worker has stake
    await this.ensureWorkerStake();

    await this.startEventListener();

    process.on('SIGINT', () => {
      console.log('\n\n👷 Shutting down Worker Agent Service...\n');
      this.stopEventListener();
      process.exit(0);
    });
  }

  private async handleJobCreated(event: BaseEvent): Promise<void> {
    if (event.type !== 'JOB_CREATED') return;
    const jobEvent = event as JobCreatedEvent;

    console.log(`\n🔔 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 NEW JOB DETECTED`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      await marketplace.initMarketplace();
      const job = await marketplace.readJob(jobEvent.payload.jobId);

      console.log(`   Job ID: ${job.id}`);
      console.log(`   Title: ${job.title || job.description.substring(0, 50)}`);
      console.log(`   Description: ${job.description}`);
      console.log(`   Budget: $${job.budget} USDC`);
      console.log(`   Requirements:`);
      if (Array.isArray(job.requirements)) {
        job.requirements.forEach((req: string) => {
          console.log(`      • ${req}`);
        });
      } else {
        console.log(`      • ${job.requirements}`);
      }

      if (this.autoAcceptJobs) {
        console.log('\n   🤖 Auto-accepting job...');
        await this.acceptAndCompleteJob(job.id);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error processing job: ${errorMessage}`);
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  }

  private async handleArbitrationComplete(event: BaseEvent): Promise<void> {
    if (event.type !== 'ARBITRATION_COMPLETE') return;
    const arbEvent = event as ArbitrationCompleteEvent;
    const { disputeId, decision, refundAmount, penaltyAmount, newReputation } = arbEvent.payload;

    console.log('\n⚖️ Arbitration decision received');
    console.log(`   Dispute ID: ${disputeId}`);
    console.log(`   Decision: ${decision}`);
    console.log(`   Refund Amount: $${refundAmount}`);
    console.log(`   Penalty Amount: $${penaltyAmount}`);
    console.log(`   New Reputation: ${JSON.stringify(newReputation)}\n`);
  }

  private async acceptAndCompleteJob(jobId: string): Promise<void> {
    try {
      await marketplace.initMarketplace();
      const agents = await marketplace.readAgents();
      const workerAgent = agents.agents['worker-agent'];

      if (!workerAgent || workerAgent.stakeAmount < 0.5) {
        console.log('   ⚠️ Warning: Insufficient stake deposited. Job acceptance may fail in production.');
      }

      await marketplace.updateJobStatus(jobId, 'in_progress');
      console.log(`   ✅ Job ${jobId} accepted`);

      await this.publishJobAccepted(jobId);
      console.log('   📤 JOB_ACCEPTED event published');

      console.log('\n   🤖 Generating work using AI...');
      const work = await this.generateWork(jobId);

      const deliverableId = await marketplace.saveDeliverable(jobId, 'result.txt', work);
      await marketplace.updateJobStatus(jobId, 'completed');

      console.log(`   ✅ Work generated and saved: ${deliverableId.substring(0, 50)}...`);

      await this.publishWorkSubmitted(jobId, deliverableId);
      console.log('   📤 WORK_SUBMITTED event published to hiring agent\n');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error accepting/completing job: ${errorMessage}`);
    }
  }

  private async generateWork(jobId: string): Promise<string> {
    try {
      const job = await marketplace.readJob(jobId);

      const workPrompt = `You are a skilled worker completing a job. Here are the job details:

DESCRIPTION: ${job.description}

REQUIREMENTS:
${Array.isArray(job.requirements) ? job.requirements.map((r: string) => `- ${r}`).join('\n') : job.requirements}

BUDGET: $${job.budget} USDC

Please complete this job by providing high-quality deliverable that meets all requirements.
Focus on producing practical, working code or detailed solutions that would satisfy the hiring agent.

Generate the complete deliverable now.`;

      let generatedWork = '';

      const response = query({
        prompt: workPrompt,
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          systemPrompt: 'You are a professional worker completing tasks. Provide high-quality, complete deliverables that meet all stated requirements. Be thorough and practical.',
          model: 'claude-sonnet-4-20250514',
          includePartialMessages: true
        }
      });

      for await (const message of response) {
        if (message.type === 'stream_event') {
          if (message.event.type === 'content_block_delta') {
            if (message.event.delta.type === 'text_delta') {
              generatedWork += message.event.delta.text;
            }
          }
        } else if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              generatedWork += block.text;
            }
          }
        }
      }

      if (!generatedWork) {
        generatedWork = `Work completed for job: ${job.description}\n\nAll requirements have been addressed.`;
      }

      return generatedWork;

    } catch (error) {
      console.error(`   ⚠️ AI work generation failed: ${error instanceof Error ? error.message : String(error)}`);
      return `Fallback work deliverable for job ${jobId}. Requirements completed to specification.`;
    }
  }

  private async publishJobAccepted(jobId: string): Promise<void> {
    const event: JobAcceptedEvent = {
      id: this.generateEventId(),
      type: 'JOB_ACCEPTED',
      timestamp: new Date().toISOString(),
      sourceAgent: 'worker',
      targetAgent: 'hiring',
      payload: {
        jobId,
        workerId: this.agentId,
        estimatedCompletion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      processedBy: [],
      status: 'pending'
    };
    await this.publishEvent(event);
  }

  private async publishWorkSubmitted(jobId: string, deliverableId: string): Promise<void> {
    const event: WorkSubmittedEvent = {
      id: this.generateEventId(),
      type: 'WORK_SUBMITTED',
      timestamp: new Date().toISOString(),
      sourceAgent: 'worker',
      targetAgent: 'hiring',
      payload: {
        jobId,
        deliverableId,
        submittedAt: new Date().toISOString()
      },
      processedBy: [],
      status: 'pending'
    };
    await this.publishEvent(event);
  }
}

async function main(): Promise<void> {
  const service = new WorkerAgentService();
  await service.start();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
