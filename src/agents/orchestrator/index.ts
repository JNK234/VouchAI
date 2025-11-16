// ABOUTME: Orchestrator agent - intelligent conversational entry point for VouchAI system
// ABOUTME: Manages all agents, provides conversational AI interface, and orchestrates the full job workflow

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
import { JobWorkflowState, ConversationMessage } from './types.js';
import { buildOrchestratorSystemPrompt, buildEventNotificationPrompt } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    console.log('║    🤖 VouchAI Orchestrator - Conversational AI Agent      ║');
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
    console.log('💬 CONVERSATIONAL MODE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Talk to me naturally! I can:');
    console.log('  • Create jobs for you');
    console.log('  • Check job status');
    console.log('  • Explain how the system works');
    console.log('  • Monitor and update you on progress');
    console.log('');
    console.log('Commands:');
    console.log('  /status  - Quick status of all jobs');
    console.log('  /exit    - Shutdown all services');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('💡 Try: "I need someone to build a REST API" or "What\'s happening with my jobs?"\n');

    this.rl.prompt();

    // Setup readline handlers
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

      // Handle special commands
      if (trimmed === '/exit' || trimmed === 'exit' || trimmed === 'quit') {
        await this.shutdown();
        return;
      }

      if (trimmed === '/status') {
        this.showStatus();
        this.rl.prompt();
        return;
      }

      // Handle empty input
      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      // All other input goes through conversational AI
      await this.chat(trimmed);
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

  /**
   * Main conversational interface
   * Handles natural language input using Claude with tool access
   */
  private async chat(userMessage: string): Promise<void> {
    try {
      // Build dynamic system prompt with current state
      const systemPrompt = buildOrchestratorSystemPrompt(
        this.activeJobs,
        ['Hiring Agent', 'Worker Agent', 'Arbitrator Agent']
      );

      // Query Claude for pure conversational response (NO TOOLS)
      const response = query({
        prompt: userMessage,
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          systemPrompt,
          model: 'claude-sonnet-4-20250514',
          includePartialMessages: true
          // NO tools, NO MCP servers - purely conversational
        }
      });

      let assistantResponse = '';
      let isStreaming = false;

      for await (const message of response) {
        if (message.type === 'stream_event') {
          if (message.event.type === 'content_block_delta') {
            if (message.event.delta.type === 'text_delta') {
              if (!isStreaming) {
                console.log('\n🤖 ');
                isStreaming = true;
              }
              process.stdout.write(message.event.delta.text);
              assistantResponse += message.event.delta.text;
            }
          }
        } else if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              if (!isStreaming) {
                console.log('\n🤖 ');
              }
              if (!assistantResponse.includes(block.text)) {
                console.log(block.text);
                assistantResponse += block.text;
              }
            }
          }
        }
      }

      if (isStreaming) {
        console.log('\n');
      }

      // Parse job requirements from user input to provide context to background agents
      const jobDetails = this.extractJobRequirements(userMessage);
      if (jobDetails) {
        console.log(`📋 Creating job for background agents: ${jobDetails.description}`);
        await this.createMinimalJob(jobDetails);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Error: ${errorMessage}\n`);
    }
  }

  /**
   * Extract job requirements from user input
   * Returns null if no clear job request found
   */
  private extractJobRequirements(userMessage: string): { description: string; budget: number; requirements: string[] } | null {
    // Look for technical task indicators
    const taskKeywords = /(build|create|make|develop|implement|write|design|code|function|calculator|api|website|app|program|script)/i;
    if (!taskKeywords.test(userMessage)) {
      return null; // Not a task request
    }

    // Extract description
    const descMatch = userMessage.match(/(?:build|create|make|develop|implement|write|design|code|need|want)\s+(.+?)(?:\s*(?:with|for|budget|in|using)|\.|,|$)/i);
    let description = descMatch ? descMatch[1].trim() : userMessage.substring(0, 50);

    // Extract budget
    const budgetMatch = userMessage.match(/\$?(\d+(?:\.\d+)?)\s*(?:USDC|usd|dollars?)?/i);
    const budget = budgetMatch ? parseFloat(budgetMatch[1]) : 0.1;

    // Extract requirements
    const requirements: string[] = [];
    const langMatch = userMessage.match(/(?:in|using|with)\s+(TypeScript|JavaScript|Python|Rust|Go|Java|C\+\+|React|Node\.js)/i);
    if (langMatch) requirements.push(`Use ${langMatch[1]}`);

    const testMatch = userMessage.match(/(?:with|include|add)\s+tests?/i);
    if (testMatch) requirements.push('Include tests');

    if (requirements.length === 0) {
      requirements.push('High quality implementation', 'Well documented');
    }

    return { description, budget, requirements };
  }

  /**
   * Create minimal job to provide context to background agents
   */
  private async createMinimalJob(jobDetails: { description: string; budget: number; requirements: string[] }): Promise<void> {
    try {
      // Create job spec
      const jobSpec = {
        title: jobDetails.description.substring(0, 50),
        description: jobDetails.description,
        requirements: jobDetails.requirements,
        budget: jobDetails.budget,
        hiringAgent: {
          walletAddress: process.env.HIRING_AGENT_WALLET || '0xHiring123',
          email: 'hiring@vouchai.com'
        }
      };

      // Create job
      const jobId = await marketplace.createJob(jobSpec);
      console.log(`✅ Job created: ${jobId}`);

      // Initialize workflow state
      const workflowState: JobWorkflowState = {
        jobId,
        description: jobDetails.description,
        budget: jobDetails.budget,
        requirements: jobDetails.requirements,
        status: 'created',
        startTime: Date.now(),
        events: []
      };

      this.activeJobs.set(jobId, workflowState);

      // Publish JOB_CREATED event
      const jobEvent: BaseEvent = {
        id: this.generateEventId(),
        type: 'JOB_CREATED',
        timestamp: new Date().toISOString(),
        sourceAgent: 'hiring',
        payload: {
          jobId,
          budget: jobDetails.budget,
          requirements: jobDetails.requirements.join(', ')
        },
        processedBy: [],
        status: 'pending'
      };

      await this.publishEvent(jobEvent);
      console.log('📤 JOB_CREATED event published - agents will handle automatically\n');

    } catch (error) {
      console.error(`❌ Job creation failed:`, error);
    }
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

  /**
   * Handle events and generate natural language notifications
   */
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
            break;
          case 'JOB_ACCEPTED':
            state.status = 'accepted';
            await this.generateEventNotification(event, jobId);
            break;
          case 'WORK_SUBMITTED':
            state.status = 'submitted';
            await this.generateEventNotification(event, jobId);
            break;
          case 'WORK_APPROVED':
            state.status = 'validated';
            await this.generateEventNotification(event, jobId);
            break;
          case 'DISPUTE_FILED':
            state.status = 'disputed';
            await this.generateEventNotification(event, jobId);
            break;
          case 'ARBITRATION_COMPLETE':
            state.status = 'resolved';
            await this.generateEventNotification(event, jobId);
            break;
          case 'PAYMENT_RELEASED':
            await this.generateEventNotification(event, jobId);
            break;
        }
      }
    }
  }

  /**
   * Generate natural language notification for events
   */
  private async generateEventNotification(event: BaseEvent, jobId: string): Promise<void> {
    try {
      const prompt = buildEventNotificationPrompt(event.type, jobId, event.payload);

      const response = query({
        prompt,
        options: {
          apiKey: process.env.ANTHROPIC_API_KEY,
          systemPrompt: 'You generate brief, friendly notifications. Just output the notification text, nothing else.',
          model: 'claude-sonnet-4-20250514'
        }
      });

      let notification = '';

      for await (const message of response) {
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              notification += block.text;
            }
          }
        }
      }

      if (notification) {
        console.log(`\n${notification.trim()}\n`);
        this.rl.prompt();
      }

    } catch (error) {
      // Fallback to simple notification if AI generation fails
      console.log(`\n📢 Event: ${event.type} for job ${jobId.substring(0, 8)}\n`);
      this.rl.prompt();
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
