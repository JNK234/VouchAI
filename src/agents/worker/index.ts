// ABOUTME: Worker Agent chatbot for accepting jobs and managing payments via Locus
// ABOUTME: Uses Claude Agent SDK with proper streaming and session management

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

class WorkerAgent extends AgentSubscriber {
  private sessionId?: string;
  private rl: readline.Interface;
  private messageHistory: ChatMessage[] = [];

  constructor() {
    super('worker', `worker-${randomUUID()}`);
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n👷 You: '
    });
  }

  protected setupEventHandlers(): void {
    this.eventBus.subscribe('JOB_CREATED', this.handleJobCreated.bind(this));
    this.eventBus.subscribe('ARBITRATION_COMPLETE', this.handleArbitrationComplete.bind(this));
  }

  async start() {
    console.log('👷 WORKER AGENT CHATBOT\n');
    console.log('I can accept jobs, deliver work, and manage payments.\n');
    console.log('Commands: /listjobs, /stake [amount], /acceptjob <jobId>, /submitwork <jobId> <deliverable>, /history, /clear, /exit\n');
    console.log('💡 Important: Stake $0.5 USDC before accepting jobs\n');

    // Start event listener for background event polling
    await this.startEventListener();

    // Configure MCP connection to Locus
    const mcpServers = {
      'locus': {
        type: 'http' as const,
        url: 'https://mcp.paywithlocus.com/mcp',
        headers: {
          'Authorization': `Bearer ${process.env.WORKER_AGENT_LOCUS_API_KEY}`
        }
      }
    };

    console.log('✓ Connected to Locus\n');

    this.rl.prompt();

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

      // Handle /listjobs command
      if (trimmed === '/listjobs' || trimmed === '/jobs') {
        try {
          await marketplace.initMarketplace();
          const jobs = await marketplace.listJobs();
          const availableJobs = jobs.filter((j: any) => j.status === 'pending');

          if (availableJobs.length === 0) {
            console.log('\n📭 No jobs available at the moment\n');
          } else {
            console.log(`\n📋 Available Jobs (${availableJobs.length}):\n`);
            availableJobs.forEach((job: any) => {
              console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              console.log(`   ID: ${job.id}`);
              console.log(`   Description: ${job.description}`);
              console.log(`   Budget: $${job.budget} USDC`);
              const reqs = Array.isArray(job.requirements) ? job.requirements.join(', ') : job.requirements;
              console.log(`   Requirements: ${reqs}`);
              console.log(`   Posted: ${new Date(job.createdAt).toLocaleString()}`);
              console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            });
            console.log(`💡 Use /acceptjob <jobId> to accept a job\n`);
          }
        } catch (error) {
          console.log(`\n❌ Failed to list jobs: ${error}\n`);
        }

        this.rl.prompt();
        return;
      }

      // Handle commands
      if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') {
        console.log('\n👋 Goodbye!\n');
        this.stopEventListener();
        process.exit(0);
      }

      if (trimmed === '/history') {
        this.showHistory();
        this.rl.prompt();
        return;
      }

      if (trimmed === '/clear') {
        this.sessionId = undefined;
        this.messageHistory = [];
        console.log('Session cleared.');
        this.rl.prompt();
        return;
      }

      // Handle /stake command
      if (trimmed === '/stake' || trimmed.startsWith('/stake ')) {
        const parts = trimmed.split(' ');
        const amount = parts[1] ? parseFloat(parts[1]) : 0.5;

        console.log(`\n🔒 Initiating stake deposit...\n`);

        // Let Claude handle the staking autonomously
        await this.sendMessage(
          `Stake ${amount} USDC as collateral (default: $0.5) by sending it to arbitrator wallet ${process.env.ARBITRATOR_WALLET} with memo "Worker stake deposit". Execute the payment now using Locus.`,
          mcpServers
        );

        // Update marketplace after Claude confirms
        await marketplace.initMarketplace();
        await marketplace.updateWorkerStake('worker-agent', amount);

        this.rl.prompt();
        return;
      }

      // Handle /acceptjob command
      if (trimmed.startsWith('/acceptjob ')) {
        const jobId = trimmed.substring('/acceptjob '.length).trim();
        if (jobId) {
          await this.acceptJobAndPublish(jobId);
        } else {
          console.log('Usage: /acceptjob <jobId>');
        }
        this.rl.prompt();
        return;
      }

      // Handle /submitwork command
      if (trimmed.startsWith('/submitwork ')) {
        const parts = trimmed.substring('/submitwork '.length).trim();
        const spaceIndex = parts.indexOf(' ');
        if (spaceIndex > 0) {
          const jobId = parts.substring(0, spaceIndex);
          const deliverable = parts.substring(spaceIndex + 1);
          await this.submitWorkAndPublish(jobId, deliverable);
        } else {
          console.log('Usage: /submitwork <jobId> <deliverable>');
        }
        this.rl.prompt();
        return;
      }

      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      // Process user message
      await this.sendMessage(trimmed, mcpServers);
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('\n👋 Goodbye!\n');
      this.stopEventListener();
      process.exit(0);
    });
  }

  private async handleJobCreated(event: BaseEvent): Promise<void> {
    if (event.type !== 'JOB_CREATED') return;
    const jobEvent = event as JobCreatedEvent;

    console.log(`\n🔔 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 NEW JOB AVAILABLE`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Read full job details from marketplace
    try {
      await marketplace.initMarketplace();
      const job = await marketplace.readJob(jobEvent.payload.jobId);

      console.log(`   Job ID: ${job.id}`);
      console.log(`   Title: ${job.title || job.description.substring(0, 50)}`);
      console.log(`   Description: ${job.description}`);
      console.log(`   Budget: $${job.budget} USDC`);
      console.log(`   Premium: $${job.premium} USDC`);
      console.log(`   Requirements:`);
      if (Array.isArray(job.requirements)) {
        job.requirements.forEach((req: string) => {
          console.log(`      • ${req}`);
        });
      } else {
        console.log(`      • ${job.requirements}`);
      }
      console.log(`   Status: ${job.status}`);
      console.log(`   Posted: ${new Date(job.createdAt).toLocaleString()}\n`);

      console.log(`💡 To accept: /acceptjob ${job.id}\n`);

    } catch (error) {
      console.log(`   Job ID: ${jobEvent.payload.jobId}`);
      console.log(`   Budget: $${jobEvent.payload.budget} USDC`);
      const reqs = Array.isArray(jobEvent.payload.requirements)
        ? jobEvent.payload.requirements.join(', ')
        : jobEvent.payload.requirements;
      console.log(`   Requirements: ${reqs}\n`);
      console.log(`💡 To accept: /acceptjob ${jobEvent.payload.jobId}\n`);
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    this.rl.prompt();
  }

  private async handleArbitrationComplete(event: BaseEvent): Promise<void> {
    if (event.type !== 'ARBITRATION_COMPLETE') return;
    const arbEvent = event as ArbitrationCompleteEvent;
    const { disputeId, decision, refundAmount, penaltyAmount, newReputation } = arbEvent.payload;
    console.log('\n⚖️ Arbitration decision received');
    console.log(`Dispute ID: ${disputeId}`);
    console.log(`Decision: ${decision}`);
    console.log(`Refund Amount: $${refundAmount}`);
    console.log(`Penalty Amount: $${penaltyAmount}`);
    console.log(`New Reputation: ${JSON.stringify(newReputation)}\n`);
    this.rl.prompt();
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

  private async acceptJobAndPublish(jobId: string): Promise<void> {
    try {
      // Check if worker has staked collateral
      await marketplace.initMarketplace();
      const agents = await marketplace.readAgents();
      const workerAgent = agents.agents['worker-agent'];

      if (!workerAgent || workerAgent.stakeAmount === 0) {
        console.log('\n❌ Cannot accept job: Must stake $0.5 USDC collateral first');
        console.log('   Use: /stake 0.5\n');
        return;
      }

      await marketplace.updateJobStatus(jobId, 'in_progress');
      console.log(`\n✅ Job ${jobId} accepted`);
      await this.publishJobAccepted(jobId);
      console.log('📤 JOB_ACCEPTED event published');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error accepting job: ${errorMessage}`);
    }
  }

  private async submitWorkAndPublish(jobId: string, deliverableContent: string): Promise<void> {
    try {
      await marketplace.initMarketplace();
      const deliverableId = await marketplace.saveDeliverable(jobId, 'result.txt', deliverableContent);
      await marketplace.updateJobStatus(jobId, 'completed');
      console.log(`\n✅ Work submitted for job ${jobId}`);
      await this.publishWorkSubmitted(jobId, deliverableId);
      console.log('📤 WORK_SUBMITTED event published to hiring agent');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error submitting work: ${errorMessage}`);
    }
  }

  private async stakeCollateral(amount: number = 0.5): Promise<void> {
    console.log(`\n🔒 Staking ${amount} USDC as collateral...\n`);

    try {
      const arbitratorWallet = process.env.ARBITRATOR_WALLET || '0xArbitratorWallet';

      const mcpServers = {
        'locus': {
          type: 'http' as const,
          url: 'https://mcp.paywithlocus.com/mcp',
          headers: {
            'Authorization': `Bearer ${process.env.WORKER_AGENT_LOCUS_API_KEY}`
          }
        }
      };

      // Use Claude to send stake via Locus
      const stakePrompt = `Send ${amount} USDC to ${arbitratorWallet} with memo "Worker stake deposit". Use the send_to_address tool.`;

      const response = query({
        prompt: stakePrompt,
        options: {
          mcpServers,
          allowedTools: ['mcp__locus__send_to_address'],
          apiKey: process.env.ANTHROPIC_API_KEY,
          canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} })
        }
      });

      let stakeTxId = 'pending';

      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              console.log(`   ${block.text}`);
              const txMatch = block.text.match(/0x[a-fA-F0-9]{64}/);
              if (txMatch) {
                stakeTxId = txMatch[0];
              }
            }
          }
        }
      }

      console.log(`✅ Stake deposited: ${stakeTxId}\n`);

      // Update marketplace
      await marketplace.initMarketplace();
      await marketplace.updateWorkerStake('worker-agent', amount);

    } catch (error) {
      console.error(`❌ Stake deposit failed: ${error}`);
    }
  }

  private async sendMessage(userInput: string, mcpServers: any) {
    // Add to history
    this.messageHistory.push({ role: 'user', content: userInput });

    console.log('\n🤖 Worker Agent: ');

    try {
      let assistantResponse = '';

      const options = {
        mcpServers,
        allowedTools: [
          'mcp__locus__*',
          'mcp__list_resources',
          'mcp__read_resource'
        ],
        apiKey: process.env.ANTHROPIC_API_KEY,
        systemPrompt: `You are a Worker Agent in the VouchAI insurance marketplace. You accept jobs, deliver work, and manage your stake collateral via Locus (USDC on Base blockchain).

JOB DISCOVERY:
When new jobs are posted, you'll receive automatic notifications showing:
- Job description and requirements
- Budget and payment terms
- Job ID for acceptance

Users can also use /listjobs to see all available jobs.

CRITICAL REQUIREMENTS:
1. You MUST stake $0.5 USDC collateral before accepting any jobs
2. Stake is sent to arbitrator wallet as security deposit
3. If work is disputed and found incomplete, you lose $50 from your stake
4. Successful job completion earns you the job budget

PAYMENT PROTOCOL:
- Stake deposit: Send 0.5 USDC to arbitrator wallet before accepting jobs
- Use Locus send_to_address tool for stake
- Track your stake amount in the marketplace

WALLET ADDRESSES:
- Arbitrator: ${process.env.ARBITRATOR_WALLET || '0xArbitratorWallet'}
- Your wallet: ${process.env.WORKER_AGENT_WALLET || '0xWorkerWallet'}

AVAILABLE COMMANDS:
- /stake [amount] - Deposit collateral (default: $0.5)
- /acceptjob <jobId> - Accept a job (requires stake)
- /submitwork <jobId> <deliverable> - Submit completed work

When user says "stake" or "deposit collateral", immediately send 0.5 USDC to arbitrator. Be proactive.`,
        // Auto-approve all Locus tools
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          if (toolName.startsWith('mcp__locus__')) {
            console.log(`\n🔧 Using: ${toolName}`);
            return { behavior: 'allow' as const, updatedInput: input };
          }
          return { behavior: 'allow' as const, updatedInput: input };
        },
        // Enable smooth streaming
        includePartialMessages: true,
        // Resume from previous session if exists
        ...(this.sessionId ? { resume: this.sessionId } : {})
      };

      const response = query({
        prompt: userInput,
        options
      });

      for await (const message of response) {
        // Capture session ID
        if (message.type === 'system' && message.subtype === 'init') {
          this.sessionId = message.session_id;
        }

        // Handle streaming text deltas for smooth output
        if (message.type === 'stream_event') {
          if (message.event.type === 'content_block_delta') {
            if (message.event.delta.type === 'text_delta') {
              const text = message.event.delta.text;
              process.stdout.write(text);
              assistantResponse += text;
            }
          }
        }

        // Handle complete assistant messages (fallback if not streaming)
        if (message.type === 'assistant' && !assistantResponse) {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              console.log(block.text);
              assistantResponse += block.text;
            }
          }
        }

        // Handle tool usage
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'tool_use') {
              console.log(`\n[Using tool: ${block.name}]`);
            }
          }
        }

        // Show usage stats and handle errors
        if (message.type === 'result') {
          console.log();
          if (message.subtype === 'error') {
            const error = (message as any).error;
            console.error(`[Error: ${error}]`);
          }

          if ((message as any).usage) {
            const usage = (message as any).usage;
            console.log(`[Tokens: ${usage.total_tokens || 0}]`);
          }
        }
      }

      // Add assistant response to history
      if (assistantResponse) {
        this.messageHistory.push({ role: 'assistant', content: assistantResponse });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('\n❌ Error:', errorMessage);
      console.error('\nPlease check:');
      console.error('  • Your .env file contains valid credentials');
      console.error('  • Your network connection is active');
      console.error('  • Your Locus and Anthropic API keys are correct\n');
    }
  }

  private showHistory() {
    console.log('\n=== Conversation History ===');
    this.messageHistory.forEach((msg, idx) => {
      console.log(`\n[${idx + 1}] ${msg.role.toUpperCase()}:`);
      console.log(msg.content);
    });
    console.log('\n=========================');
  }
}

// Start the agent
async function main(): Promise<void> {
  const agent = new WorkerAgent();
  await agent.start();
}

main();
