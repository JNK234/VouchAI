// ABOUTME: Background service for ArbitratorAgent - runs as daemon without CLI interaction
// ABOUTME: Automatically processes disputes and releases payments via EventBus

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentSubscriber } from '../../communication/AgentSubscriber.js';
import { DisputeFiledEvent, WorkApprovedEvent, ArbitrationCompleteEvent, BaseEvent } from '../../communication/events.js';
import { randomUUID } from 'crypto';
import * as marketplace from '../../shared/marketplace.js';

class ArbitratorAgentService extends AgentSubscriber {
  private walletAddress: string;

  constructor() {
    super('arbitrator', `arbitrator-${randomUUID()}`);

    this.walletAddress = process.env.ARBITRATOR_WALLET!;
    if (!this.walletAddress) {
      throw new Error('ARBITRATOR_WALLET not configured in .env - please add your wallet address');
    }

    console.log(`⚖️ Arbitrator Agent Service initialized`);
    console.log(`   Wallet: ${this.walletAddress}`);
  }

  protected setupEventHandlers(): void {
    this.eventBus.subscribe('DISPUTE_FILED', this.handleDisputeFiled.bind(this));
    this.eventBus.subscribe('WORK_APPROVED', this.handleWorkApproved.bind(this));
  }

  async start(): Promise<void> {
    console.log('\n⚖️ ARBITRATOR AGENT SERVICE STARTING\n');
    console.log('Mode: Background service (no CLI interaction)');
    console.log('Listening for: DISPUTE_FILED, WORK_APPROVED events');
    console.log('Auto-arbitrate: Enabled (disputes will be resolved automatically)\n');
    console.log('Press Ctrl+C to stop\n');

    await this.startEventListener();

    process.on('SIGINT', () => {
      console.log('\n\n⚖️ Shutting down Arbitrator Agent Service...\n');
      this.stopEventListener();
      process.exit(0);
    });
  }

  private async handleWorkApproved(event: BaseEvent): Promise<void> {
    const workApprovedEvent = event as WorkApprovedEvent;
    console.log(`\n💰 Work approved for job ${workApprovedEvent.payload.jobId}`);
    console.log(`   Validation score: ${workApprovedEvent.payload.validationScore.toFixed(1)}%`);

    try {
      await marketplace.initMarketplace();
      const job = await marketplace.readJob(workApprovedEvent.payload.jobId);
      const workerWallet = job.workerAgent?.walletAddress || process.env.WORKER_AGENT_WALLET || '0xWorkerWallet';

      console.log(`   💸 Paying ${job.budget} USDC to worker from escrow...`);

      const mcpServers = {
        'locus': {
          type: 'http' as const,
          url: 'https://mcp.paywithlocus.com/mcp',
          headers: {
            'Authorization': `Bearer ${process.env.ARBITRATOR_LOCUS_API_KEY}`
          }
        }
      };

      const paymentPrompt = `Send ${job.budget} USDC to ${workerWallet} with memo "Payment for completed job ${job.id}". Use the send_to_address tool.`;

      const response = query({
        prompt: paymentPrompt,
        options: {
          mcpServers,
          allowedTools: ['mcp__locus__send_to_address'],
          apiKey: process.env.ANTHROPIC_API_KEY,
          canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} })
        }
      });

      let paymentTxId = 'pending';

      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              console.log(`   ${block.text}`);
              const txMatch = block.text.match(/0x[a-fA-F0-9]{64}/);
              if (txMatch) {
                paymentTxId = txMatch[0];
              }
            }
          }
        }
      }

      console.log(`   ✅ Payment released to worker: ${paymentTxId}`);
      console.log(`   💼 Arbitrator keeps 1% premium from escrow\n`);

      await marketplace.updateJobStatus(job.id, 'completed', {
        paymentReleasedTxId: paymentTxId,
        paidAt: new Date().toISOString()
      });

      const paymentEvent: BaseEvent = {
        id: this.generateEventId(),
        type: 'PAYMENT_RELEASED',
        timestamp: new Date().toISOString(),
        sourceAgent: 'arbitrator',
        payload: {
          jobId: job.id,
          amount: job.budget,
          recipientAgent: 'worker'
        },
        processedBy: [],
        status: 'pending'
      };

      await this.publishEvent(paymentEvent);
      console.log('   📤 PAYMENT_RELEASED event published\n');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error releasing payment: ${errorMessage}`);
    }
  }

  private async handleDisputeFiled(event: BaseEvent): Promise<void> {
    const disputeEvent = event as DisputeFiledEvent;
    const disputeId = disputeEvent.payload.disputeId;

    console.log('\n⚖️ DISPUTE RECEIVED - Processing autonomously...');
    console.log(`  📋 Job: ${disputeEvent.payload.jobId}`);
    console.log(`  📋 Dispute: ${disputeId}`);
    console.log(`  📋 Reason: ${disputeEvent.payload.reason}\n`);

    try {
      await marketplace.initMarketplace();
      const dispute = await marketplace.readDispute(disputeId);
      const job = await marketplace.readJob(dispute.jobId);

      console.log('  🤖 Evaluating evidence using AI reasoning...');
      const { decision, refundAmount, penaltyAmount, reputationDelta } =
        await this.arbitrateDispute(dispute, job);

      const newReputation = 100 + reputationDelta;

      console.log(`  ⚖️ DECISION: ${decision}`);
      console.log(`  💵 Refund: $${refundAmount}`);
      console.log(`  ⚠️ Penalty: $${penaltyAmount}`);
      console.log(`  📊 New reputation: ${newReputation}\n`);

      await marketplace.updateDispute(disputeId, {
        status: 'resolved',
        arbitratorDecision: {
          ruling: refundAmount === job.budget ? 'INCOMPLETE' : refundAmount > 0 ? 'PARTIAL' : 'COMPLETE',
          reasoning: decision,
          refundAmount,
          penaltyAmount,
          decidedAt: new Date().toISOString()
        }
      });

      await marketplace.updateReputation('worker-agent', reputationDelta);
      await marketplace.updateWorkerStake('worker-agent', -penaltyAmount);

      console.log('  💸 Refund simulation (requires Locus MCP for actual payment)...\n');
      console.log(`  ✅ Simulated refund of $${refundAmount} to hiring agent\n`);

      await marketplace.updateJobStatus(job.id, 'resolved');

      await this.publishArbitrationComplete(disputeId, {
        decision,
        refundAmount,
        penaltyAmount,
        newReputation: { workerAgent: newReputation }
      });

      console.log('✅ Arbitration complete - Decision published\n');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Error processing dispute: ${errorMessage}\n`);
    }
  }

  private async arbitrateDispute(
    dispute: any,
    job: any
  ): Promise<{decision: string, refundAmount: number, penaltyAmount: number, reputationDelta: number}> {

    console.log('  🤖 Using AI to evaluate dispute...\n');

    const arbitrationPrompt = `You are an impartial AI arbitrator evaluating a work dispute.

JOB DETAILS:
- Requirements: ${JSON.stringify(job.requirements)}
- Budget: $${job.budget}

DISPUTE:
- Reason: ${dispute.reason}
- Evidence: ${JSON.stringify(dispute.evidence)}

EVALUATION CRITERIA:
- < 70% complete: INCOMPLETE (full refund, $50 penalty, -40 reputation)
- 70-90% complete: PARTIAL (50% refund, $25 penalty, -20 reputation)
- > 90% complete: COMPLETE (no refund, no penalty, no reputation change)

Provide your decision in this EXACT format:
RULING: [INCOMPLETE|PARTIAL|COMPLETE]
REASONING: [your detailed reasoning]
REFUND: [dollar amount]
PENALTY: [dollar amount]
REPUTATION_DELTA: [number]`;

    let decision = 'Work did not meet requirements';
    let refundAmount = job.budget;
    let penaltyAmount = 50;
    let reputationDelta = -40;

    try {
      const response = query({
        prompt: arbitrationPrompt,
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          systemPrompt: 'You are a fair and impartial arbitrator. Analyze evidence objectively.',
          includePartialMessages: true
        }
      });

      let fullResponse = '';

      for await (const message of response) {
        if (message.type === 'stream_event') {
          if (message.event.type === 'content_block_delta') {
            if (message.event.delta.type === 'text_delta') {
              const text = message.event.delta.text;
              process.stdout.write(text);
              fullResponse += text;
            }
          }
        }
      }

      console.log('\n');

      const rulingMatch = fullResponse.match(/RULING:\s*(INCOMPLETE|PARTIAL|COMPLETE)/i);
      const reasoningMatch = fullResponse.match(/REASONING:\s*(.+?)(?=REFUND:|$)/s);
      const refundMatch = fullResponse.match(/REFUND:\s*\$?(\d+)/);
      const penaltyMatch = fullResponse.match(/PENALTY:\s*\$?(\d+)/);
      const reputationMatch = fullResponse.match(/REPUTATION_DELTA:\s*(-?\d+)/);

      if (reasoningMatch) decision = reasoningMatch[1].trim();
      if (refundMatch) refundAmount = parseInt(refundMatch[1], 10);
      if (penaltyMatch) penaltyAmount = parseInt(penaltyMatch[1], 10);
      if (reputationMatch) reputationDelta = parseInt(reputationMatch[1], 10);

    } catch (error) {
      console.error('  ❌ AI arbitration failed, using default decision');
    }

    return { decision, refundAmount, penaltyAmount, reputationDelta };
  }

  private async publishArbitrationComplete(disputeId: string, decision: any): Promise<void> {
    const event: ArbitrationCompleteEvent = {
      id: this.generateEventId(),
      type: 'ARBITRATION_COMPLETE',
      timestamp: new Date().toISOString(),
      sourceAgent: 'arbitrator',
      payload: {
        disputeId,
        decision: decision.decision,
        refundAmount: decision.refundAmount,
        penaltyAmount: decision.penaltyAmount,
        newReputation: decision.newReputation
      },
      processedBy: [],
      status: 'pending'
    };

    await this.publishEvent(event);
  }
}

async function main(): Promise<void> {
  const service = new ArbitratorAgentService();
  await service.start();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
