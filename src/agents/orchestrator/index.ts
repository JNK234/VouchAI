// ABOUTME: Orchestrator agent - single entry point for VouchAI system
// ABOUTME: Manages all agents, provides CLI interface, and orchestrates the full job workflow

import 'dotenv/config';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { AgentSubscriber } from '../../communication/AgentSubscriber.js';
import { BaseEvent, EventType } from '../../communication/events.js';
import { randomUUID } from 'crypto';
import * as marketplace from '../../shared/marketplace.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface JobWorkflowState {
  jobId: string;
  description: string;
  budget: number;
  requirements: string[];
  status: 'created' | 'accepted' | 'submitted' | 'validated' | 'resolved' | 'disputed';
  startTime: number;
  events: Array<{ type: EventType; timestamp: string; details: any }>;
}

class OrchestratorAgent extends AgentSubscriber {
  private rl: readline.Interface;
  private services: Map<string, ChildProcess> = new Map();
  private activeJobs: Map<string, JobWorkflowState> = new Map();
  private isShuttingDown: boolean = false;

  constructor() {
    super('hiring', `orchestrator-${randomUUID()}`);

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n🎯 VouchAI> '
    });
  }

  protected setupEventHandlers(): void {
    // Subscribe to ALL event types for monitoring
    this.eventBus.subscribe('JOB_CREATED', this.handleEvent.bind(this));
    this.eventBus.subscribe('JOB_ACCEPTED', this.handleEvent.bind(this));
    this.eventBus.subscribe('WORK_SUBMITTED', this.handleEvent.bind(this));
    this.eventBus.subscribe('WORK_APPROVED', this.handleEvent.bind(this));
    this.eventBus.subscribe('DISPUTE_FILED', this.handleEvent.bind(this));
    this.eventBus.subscribe('ARBITRATION_COMPLETE', this.handleEvent.bind(this));
    this.eventBus.subscribe('PAYMENT_RELEASED', this.handleEvent.bind(this));
  }

  async start(): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         🎯 VouchAI Orchestrator - Single Entry Point      ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log('Starting all background services...\n');

    // Initialize marketplace
    await marketplace.initMarketplace();

    // Spawn background services
    await this.spawnServices();

    // Wait for services to initialize
    console.log('⏳ Waiting for services to initialize (3 seconds)...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start event listener
    await this.startEventListener();

    console.log('\n✅ All services running!\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('COMMANDS:');
    console.log('  /create  - Create a new job (interactive)');
    console.log('  /status  - Check status of active jobs');
    console.log('  /exit    - Shutdown all services and exit');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('💡 Example: /create\n');
    console.log('   Then type: "Create job for fibonacci calculator, budget 0.1 USDC"\n');

    this.rl.prompt();

    // Setup readline handlers
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

      if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') {
        await this.shutdown();
        return;
      }

      if (trimmed === '/status') {
        this.showStatus();
        this.rl.prompt();
        return;
      }

      if (trimmed === '/create' || trimmed.startsWith('/create ')) {
        const jobDescription = trimmed.substring('/create'.length).trim();
        if (jobDescription) {
          await this.createJobFromInput(jobDescription);
        } else {
          console.log('\n📝 Please describe the job you want to create:');
          console.log('   Example: "Create job for fibonacci calculator, budget 0.1 USDC, must be written in rust"\n');
        }
        this.rl.prompt();
        return;
      }

      // If not a command, treat as job creation
      if (trimmed) {
        await this.createJobFromInput(trimmed);
      }

      this.rl.prompt();
    });

    this.rl.on('close', async () => {
      await this.shutdown();
    });

    // Handle process signals
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Received interrupt signal...');
      await this.shutdown();
    });
  }

  private async spawnServices(): Promise<void> {
    const services = [
      { name: 'hiring', path: '../hiring/service.ts' },
      { name: 'worker', path: '../worker/service.ts' },
      { name: 'arbitrator', path: '../arbitrator/service.ts' }
    ];

    for (const service of services) {
      const servicePath = join(__dirname, service.path);

      const child = spawn('tsx', [servicePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...process.env }
      });

      this.services.set(service.name, child);

      // Capture stdout
      child.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) {
            console.log(`  [${service.name.toUpperCase()}] ${line}`);
          }
        });
      });

      // Capture stderr
      child.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) {
            console.error(`  [${service.name.toUpperCase()} ERROR] ${line}`);
          }
        });
      });

      // Handle crashes
      child.on('exit', (code) => {
        if (!this.isShuttingDown) {
          console.log(`\n⚠️  [${service.name.toUpperCase()}] service exited with code ${code}`);
          console.log(`   Restarting in 2 seconds...`);

          setTimeout(() => {
            if (!this.isShuttingDown) {
              console.log(`   🔄 Restarting [${service.name.toUpperCase()}]...`);
              this.spawnServices(); // Restart all services
            }
          }, 2000);
        }
      });

      console.log(`✅ Started [${service.name.toUpperCase()}] service (PID: ${child.pid})`);
    }
  }

  private async createJobFromInput(input: string): Promise<void> {
    console.log('\n📝 Processing job request...');

    try {
      // Use Claude to parse the job description
      const parsePrompt = `Parse this job request and extract the key information.

USER REQUEST:
"${input}"

Extract:
1. Description: A clear description of what needs to be done
2. Budget: The USDC amount (if not specified, suggest 0.1)
3. Requirements: List of specific requirements (as an array)

Respond in this EXACT JSON format (no markdown, just JSON):
{
  "description": "clear description here",
  "budget": 0.1,
  "requirements": ["requirement 1", "requirement 2", "requirement 3"]
}`;

      let jobSpec: any = null;

      const response = query({
        prompt: parsePrompt,
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          systemPrompt: 'You are a job specification parser. Extract job details and respond with ONLY valid JSON. No markdown, no explanations, just JSON.',
          model: 'claude-sonnet-4-20250514'
        }
      });

      let fullResponse = '';

      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              fullResponse += block.text;
            }
          }
        }
      }

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jobSpec = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Could not parse job specification');
      }

      console.log('\n📋 Parsed Job Specification:');
      console.log(`   Description: ${jobSpec.description}`);
      console.log(`   Budget: $${jobSpec.budget} USDC`);
      console.log(`   Requirements: ${jobSpec.requirements.join(', ')}\n`);

      // Create the job
      await this.createJobAndExecuteWorkflow(
        jobSpec.description,
        jobSpec.budget,
        jobSpec.requirements
      );

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error processing job: ${errorMessage}\n`);
    }
  }

  private async createJobAndExecuteWorkflow(
    description: string,
    budget: number,
    requirements: string[]
  ): Promise<void> {
    try {
      console.log('🔧 Creating job in marketplace...');

      // Create job spec
      const jobSpec = {
        title: description.substring(0, 50),
        description,
        requirements,
        budget,
        hiringAgent: {
          walletAddress: process.env.HIRING_AGENT_WALLET || '0xHiring123',
          email: 'hiring@vouchai.com'
        }
      };

      // Create job
      const jobId = await marketplace.createJob(jobSpec);
      console.log(`✅ Job created: ${jobId}\n`);

      // Initialize workflow state
      const workflowState: JobWorkflowState = {
        jobId,
        description,
        budget,
        requirements,
        status: 'created',
        startTime: Date.now(),
        events: []
      };

      this.activeJobs.set(jobId, workflowState);

      // Execute escrow payment
      console.log('💰 Executing escrow payment via Locus...');
      const escrowAmount = budget + (budget * 0.01); // budget + 1% premium
      const arbitratorWallet = process.env.ARBITRATOR_WALLET || '0xArbitratorWallet';

      const mcpServers = {
        'locus': {
          type: 'http' as const,
          url: 'https://mcp.paywithlocus.com/mcp',
          headers: {
            'Authorization': `Bearer ${process.env.HIRING_AGENT_LOCUS_API_KEY}`
          }
        }
      };

      const paymentPrompt = `Send ${escrowAmount} USDC to ${arbitratorWallet} with memo "Escrow for job ${jobId}". Use send_to_address tool.`;

      const paymentResponse = query({
        prompt: paymentPrompt,
        options: {
          mcpServers,
          allowedTools: ['mcp__locus__send_to_address'],
          apiKey: process.env.ANTHROPIC_API_KEY,
          canUseTool: async () => ({ behavior: 'allow' as const, updatedInput: {} })
        }
      });

      let escrowTxId = 'pending';

      for await (const message of paymentResponse) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              const txMatch = block.text.match(/0x[a-fA-F0-9]{64}/);
              if (txMatch) {
                escrowTxId = txMatch[0];
              }
            }
          }
        }
      }

      console.log(`✅ Escrow payment executed: ${escrowTxId}`);
      console.log(`   Amount: $${escrowAmount} USDC ($${budget} + $${budget * 0.01} premium)\n`);

      // Publish JOB_CREATED event
      const jobEvent: BaseEvent = {
        id: this.generateEventId(),
        type: 'JOB_CREATED',
        timestamp: new Date().toISOString(),
        sourceAgent: 'hiring',
        payload: {
          jobId,
          budget,
          requirements: requirements.join(', ')
        },
        processedBy: [],
        status: 'pending'
      };

      await this.publishEvent(jobEvent);
      console.log('📤 JOB_CREATED event published to workers\n');

      // Start monitoring
      console.log('👀 Monitoring job progress...');
      console.log('   Timeout: 5 minutes\n');
      this.startJobMonitoring(jobId);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Job creation failed: ${errorMessage}\n`);
    }
  }

  private startJobMonitoring(jobId: string): void {
    const startTime = Date.now();
    const timeoutMs = 5 * 60 * 1000; // 5 minutes

    const monitorInterval = setInterval(async () => {
      const elapsed = Date.now() - startTime;

      if (elapsed > timeoutMs) {
        clearInterval(monitorInterval);
        console.log(`\n⏰ Job ${jobId} monitoring timeout (5 minutes)\n`);
        this.displayJobSummary(jobId);
        return;
      }

      const workflowState = this.activeJobs.get(jobId);
      if (workflowState && workflowState.status === 'resolved') {
        clearInterval(monitorInterval);
        console.log(`\n✅ Job ${jobId} complete!\n`);
        this.displayJobSummary(jobId);
      }
    }, 1000);
  }

  private async handleEvent(event: BaseEvent): Promise<void> {
    // Find jobs related to this event
    for (const [jobId, state] of this.activeJobs.entries()) {
      if (event.payload.jobId === jobId) {
        // Log event
        state.events.push({
          type: event.type,
          timestamp: event.timestamp,
          details: event.payload
        });

        // Update status
        switch (event.type) {
          case 'JOB_CREATED':
            state.status = 'created';
            console.log(`\n📋 [${jobId}] Job created`);
            break;
          case 'JOB_ACCEPTED':
            state.status = 'accepted';
            console.log(`\n✅ [${jobId}] Job accepted by worker`);
            break;
          case 'WORK_SUBMITTED':
            state.status = 'submitted';
            console.log(`\n📦 [${jobId}] Work submitted`);
            break;
          case 'WORK_APPROVED':
            state.status = 'validated';
            console.log(`\n✓ [${jobId}] Work validated (score: ${event.payload.validationScore}%)`);
            break;
          case 'DISPUTE_FILED':
            state.status = 'disputed';
            console.log(`\n⚠️  [${jobId}] Dispute filed: ${event.payload.reason}`);
            break;
          case 'ARBITRATION_COMPLETE':
            state.status = 'resolved';
            console.log(`\n⚖️  [${jobId}] Arbitration complete`);
            console.log(`    Decision: ${event.payload.decision}`);
            console.log(`    Refund: $${event.payload.refundAmount}`);
            console.log(`    Penalty: $${event.payload.penaltyAmount}`);
            break;
          case 'PAYMENT_RELEASED':
            console.log(`\n💰 [${jobId}] Payment released to ${event.payload.recipientAgent}`);
            console.log(`    Amount: $${event.payload.amount}`);
            break;
        }
      }
    }
  }

  private showStatus(): void {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('ACTIVE JOBS STATUS');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (this.activeJobs.size === 0) {
      console.log('  No active jobs\n');
      return;
    }

    for (const [jobId, state] of this.activeJobs.entries()) {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      console.log(`Job ID: ${jobId}`);
      console.log(`  Description: ${state.description}`);
      console.log(`  Budget: $${state.budget} USDC`);
      console.log(`  Status: ${state.status}`);
      console.log(`  Elapsed: ${elapsed}s`);
      console.log(`  Events: ${state.events.length}`);
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════\n');
  }

  private displayJobSummary(jobId: string): void {
    const state = this.activeJobs.get(jobId);
    if (!state) return;

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`JOB SUMMARY: ${jobId}`);
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Description: ${state.description}`);
    console.log(`Budget: $${state.budget} USDC`);
    console.log(`Final Status: ${state.status}`);
    console.log(`Total Time: ${Math.floor((Date.now() - state.startTime) / 1000)}s`);
    console.log('\nEvent Timeline:');

    state.events.forEach((evt, idx) => {
      console.log(`  ${idx + 1}. ${evt.type} (${new Date(evt.timestamp).toLocaleTimeString()})`);
    });

    console.log('═══════════════════════════════════════════════════════════\n');
  }

  private async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('\n\n🛑 Shutting down VouchAI Orchestrator...\n');

    // Stop event listener
    this.stopEventListener();

    // Kill all child processes
    console.log('Stopping background services...');
    for (const [name, child] of this.services.entries()) {
      console.log(`  Stopping [${name.toUpperCase()}]...`);
      child.kill('SIGINT');
    }

    // Wait for processes to exit
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n👋 Goodbye!\n');
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const orchestrator = new OrchestratorAgent();
  await orchestrator.start();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
