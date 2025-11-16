// ABOUTME: Background service for HiringAgent - runs as daemon without CLI interaction
// ABOUTME: Automatically validates work submissions and files disputes via EventBus

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentSubscriber } from '../../communication/AgentSubscriber.js';
import { WorkSubmittedEvent, ArbitrationCompleteEvent, BaseEvent } from '../../communication/events.js';
import { randomUUID } from 'crypto';
import * as marketplace from '../../shared/marketplace.js';

class HiringAgentService extends AgentSubscriber {
  private walletAddress: string;

  constructor() {
    super('hiring', `hiring-${randomUUID()}`);

    this.walletAddress = process.env.HIRING_AGENT_WALLET!;
    if (!this.walletAddress) {
      throw new Error('HIRING_AGENT_WALLET not configured in .env - please add your wallet address');
    }

    console.log(`💼 Hiring Agent Service initialized`);
    console.log(`   Wallet: ${this.walletAddress}`);
  }

  protected setupEventHandlers(): void {
    this.eventBus.subscribe('WORK_SUBMITTED', this.handleWorkSubmitted.bind(this));
    this.eventBus.subscribe('ARBITRATION_COMPLETE', this.handleArbitrationComplete.bind(this));
  }

  async start(): Promise<void> {
    console.log('\n💼 HIRING AGENT SERVICE STARTING\n');
    console.log('Mode: Background service (no CLI interaction)');
    console.log('Listening for: WORK_SUBMITTED, ARBITRATION_COMPLETE events\n');
    console.log('Press Ctrl+C to stop\n');

    await this.startEventListener();

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n\n💼 Shutting down Hiring Agent Service...\n');
      this.stopEventListener();
      process.exit(0);
    });
  }

  private async handleWorkSubmitted(event: BaseEvent): Promise<void> {
    const workEvent = event as WorkSubmittedEvent;
    console.log(`\n🔔 New work submitted for job ${workEvent.payload.jobId}`);
    console.log(`   Deliverable ID: ${workEvent.payload.deliverableId}`);
    console.log(`   Submitted at: ${workEvent.payload.submittedAt}`);

    try {
      await marketplace.initMarketplace();
      const job = await marketplace.readJob(workEvent.payload.jobId);
      console.log(`   Job budget: $${job.budget}`);

      console.log('   🔍 Validating work with AI...\n');

      const deliverablePath = workEvent.payload.deliverableId;
      const validationScore = await this.validateWork(job, deliverablePath);
      console.log(`\n   📊 Validation score: ${validationScore.toFixed(1)}%`);

      if (validationScore < 70) {
        console.log('   ❌ Validation failed - filing dispute automatically');

        const reason = `Work validation failed with score ${validationScore.toFixed(1)}% (threshold: 70%)`;
        const evidence = {
          requiredFeatures: job.requirements,
          deliveredFeatures: [],
          completionPercentage: validationScore
        };

        const disputeId = await marketplace.fileDispute(
          workEvent.payload.jobId,
          'hiring-agent',
          reason,
          evidence
        );

        console.log(`   📁 Dispute saved to marketplace: ${disputeId}`);

        const disputeEvent: BaseEvent = {
          id: this.generateEventId(),
          type: 'DISPUTE_FILED',
          timestamp: new Date().toISOString(),
          sourceAgent: 'hiring',
          targetAgent: 'arbitrator',
          payload: {
            jobId: workEvent.payload.jobId,
            disputeId,
            reason,
            evidence: `Deliverable ${workEvent.payload.deliverableId} completed only ${validationScore.toFixed(1)}% of requirements.`
          },
          processedBy: [],
          status: 'pending'
        };

        await this.publishEvent(disputeEvent);
        console.log('   📤 Dispute filed and sent to arbitrator');
      } else {
        console.log('   ✅ Work validated successfully - notifying arbitrator to release payment\n');

        const workApprovedEvent: BaseEvent = {
          id: this.generateEventId(),
          type: 'WORK_APPROVED',
          timestamp: new Date().toISOString(),
          sourceAgent: 'hiring',
          targetAgent: 'arbitrator',
          payload: {
            jobId: workEvent.payload.jobId,
            validationScore
          },
          processedBy: [],
          status: 'pending'
        };

        await this.publishEvent(workApprovedEvent);
        console.log('   📤 WORK_APPROVED event sent to arbitrator for payment release\n');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error processing work submission: ${errorMessage}`);
    }
  }

  private async handleArbitrationComplete(event: BaseEvent): Promise<void> {
    const arbitrationEvent = event as ArbitrationCompleteEvent;
    console.log('\n⚖️ Arbitration decision received');
    console.log(`   Dispute ID: ${arbitrationEvent.payload.disputeId}`);
    console.log(`   Decision: ${arbitrationEvent.payload.decision}`);
    console.log(`   Refund Amount: $${arbitrationEvent.payload.refundAmount}`);
    console.log(`   Penalty Amount: $${arbitrationEvent.payload.penaltyAmount}`);

    if (arbitrationEvent.payload.newReputation.hiringAgent !== undefined) {
      console.log(`   New Reputation: ${arbitrationEvent.payload.newReputation.hiringAgent}`);
    }

    console.log('   📝 Arbitration results recorded');
  }

  private async validateWork(job: any, deliverablePath: string): Promise<number> {
    let deliverableContent = 'No deliverable found';

    try {
      deliverableContent = await marketplace.readDeliverable(deliverablePath);
    } catch (error) {
      console.log('   ⚠️ Could not read deliverable file');
    }

    const validationPrompt = `Evaluate this completed work against the job requirements.

JOB REQUIREMENTS:
${JSON.stringify(job.requirements, null, 2)}

DELIVERED WORK:
${deliverableContent}

Analyze the work and provide a completion percentage from 0-100 based on:
1. How many requirements are met
2. Quality of implementation
3. Completeness of the solution

Respond with ONLY a number between 0 and 100 representing the completion percentage. No other text.`;

    let score = 60;

    try {
      const response = query({
        prompt: validationPrompt,
        options: {
          systemPrompt: 'You are a work quality evaluator. Analyze the delivered work against the requirements and respond with ONLY a number from 0-100 representing completion percentage. No explanations, just the number.',
          model: 'claude-sonnet-4-20250514'
        }
      });

      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              console.log(`   💭 Claude evaluation: ${block.text.trim()}`);
              const scoreMatch = block.text.trim().match(/(\d+)/);
              if (scoreMatch) {
                const parsedScore = parseInt(scoreMatch[1], 10);
                if (parsedScore >= 0 && parsedScore <= 100) {
                  score = parsedScore;
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`   ⚠️ Validation API call failed, using default score of ${score}%`);
      console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return score;
  }
}

async function main(): Promise<void> {
  const service = new HiringAgentService();
  await service.start();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
