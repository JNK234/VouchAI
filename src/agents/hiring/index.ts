// ABOUTME: Hiring Agent chatbot for managing payments and jobs via Locus
// ABOUTME: Uses Claude Agent SDK with proper streaming and session management

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';
import { AgentSubscriber } from '../../communication/AgentSubscriber.js';
import { WorkSubmittedEvent, ArbitrationCompleteEvent, JobCreatedEvent, BaseEvent } from '../../communication/events.js';
import { randomUUID } from 'crypto';
import * as marketplace from '../../shared/marketplace.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

class HiringAgent extends AgentSubscriber {
  private sessionId?: string;
  private rl: readline.Interface;
  private messageHistory: ChatMessage[] = [];
  private walletAddress: string;

  constructor() {
    super('hiring', `hiring-${randomUUID()}`);

    this.walletAddress = process.env.HIRING_AGENT_WALLET!;
    if (!this.walletAddress) {
      throw new Error('HIRING_AGENT_WALLET not configured in .env - please add your wallet address');
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n💼 You: '
    });
  }

  protected setupEventHandlers(): void {
    this.eventBus.subscribe('WORK_SUBMITTED', this.handleWorkSubmitted.bind(this));
    this.eventBus.subscribe('ARBITRATION_COMPLETE', this.handleArbitrationComplete.bind(this));
  }

  async start() {
    console.log('💼 HIRING AGENT CHATBOT\n');
    console.log('I can help you manage payments and jobs via Locus.\n');
    console.log('Commands: /history, /clear, /exit\n');
    console.log('💡 Just tell me what job you want to create - I\'ll understand!\n');
    console.log('Example: "Create a job to build a fibonacci sequence with budget 0.1 USDC, must be written in rust"\n');

    // Start event listener for background event processing
    await this.startEventListener();

    // Configure MCP connection to Locus
    const mcpServers = {
      'locus': {
        type: 'http' as const,
        url: 'https://mcp.paywithlocus.com/mcp',
        headers: {
          'Authorization': `Bearer ${process.env.HIRING_AGENT_LOCUS_API_KEY}`
        }
      }
    };

    console.log('✓ Connected to Locus\n');

    this.rl.prompt();

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

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

  private async handleWorkSubmitted(event: BaseEvent): Promise<void> {
    const workEvent = event as WorkSubmittedEvent;
    console.log(`\n🔔 New work submitted for job ${workEvent.payload.jobId}`);
    console.log(`   Deliverable ID: ${workEvent.payload.deliverableId}`);
    console.log(`   Submitted at: ${workEvent.payload.submittedAt}`);

    try {
      // Initialize marketplace
      await marketplace.initMarketplace();

      // Read the job details from marketplace
      const job = await marketplace.readJob(workEvent.payload.jobId);
      console.log(`   Job budget: $${job.budget}`);

      // Use Claude to validate work quality
      console.log('   🔍 Validating work with AI...\n');

      const deliverablePath = workEvent.payload.deliverableId;
      const validationScore = await this.validateWork(job, deliverablePath);
      console.log(`\n   📊 Validation score: ${validationScore.toFixed(1)}%`);

      // If validation fails (< 70% complete), auto-file dispute
      if (validationScore < 70) {
        console.log('   ❌ Validation failed - filing dispute automatically');

        const reason = `Work validation failed with score ${validationScore.toFixed(1)}% (threshold: 70%)`;
        const evidence = {
          requiredFeatures: job.requirements,
          deliveredFeatures: [], // Would be populated by actual validation
          completionPercentage: validationScore
        };

        // Create dispute via marketplace
        const disputeId = await marketplace.fileDispute(
          workEvent.payload.jobId,
          'hiring-agent',
          reason,
          evidence
        );

        console.log(`   📁 Dispute saved to marketplace: ${disputeId}`);

        // Publish DISPUTE_FILED event
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
        console.log('   ✅ Work validated successfully - releasing payment\n');

        try {
          // Read job to get worker wallet and budget
          const job = await marketplace.readJob(workEvent.payload.jobId);
          const workerWallet = job.workerAgent?.walletAddress || process.env.WORKER_AGENT_WALLET || '0xWorkerWallet';

          console.log(`   💸 Paying ${job.budget} USDC to worker...`);

          const mcpServers = {
            'locus': {
              type: 'http' as const,
              url: 'https://mcp.paywithlocus.com/mcp',
              headers: {
                'Authorization': `Bearer ${process.env.HIRING_AGENT_LOCUS_API_KEY}`
              }
            }
          };

          // Use Claude to execute payment via Locus
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

          console.log(`   ✅ Payment released: ${paymentTxId}\n`);

          // Update job status
          await marketplace.updateJobStatus(job.id, 'completed', {
            paymentReleasedTxId: paymentTxId,
            paidAt: new Date().toISOString()
          });

          // Publish PAYMENT_RELEASED event
          const paymentEvent: BaseEvent = {
            id: this.generateEventId(),
            type: 'PAYMENT_RELEASED',
            timestamp: new Date().toISOString(),
            sourceAgent: 'hiring',
            payload: {
              jobId: job.id,
              amount: job.budget,
              recipientAgent: 'worker',
              transactionId: paymentTxId
            },
            processedBy: [],
            status: 'pending'
          };

          await this.publishEvent(paymentEvent);
          console.log('   📤 PAYMENT_RELEASED event published\n');

        } catch (error) {
          console.error(`   ❌ Payment release failed: ${error}`);
        }
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

    // Update local state (for now just log)
    console.log('   📝 Updating local state with arbitration results');
  }

  private async createJobAndPublish(description: string, budget: number, requirements: string[]): Promise<void> {
    try {
      console.log('\n📝 Creating job...');

      // Initialize marketplace
      await marketplace.initMarketplace();

      // Create job spec
      const jobSpec = {
        title: description.substring(0, 50),
        description,
        requirements,
        budget,
        hiringAgent: {
          walletAddress: '0xHiring123',
          email: 'hiring@vouchai.com'
        }
      };

      // Create job in marketplace
      const jobId = await marketplace.createJob(jobSpec);
      console.log(`\n✅ Job created: ${jobId}`);

      // Publish JOB_CREATED event
      await this.publishJobCreated(jobId, budget, requirements);
      console.log('📤 JOB_CREATED event published to workers');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`\n❌ Failed to create job: ${errorMessage}`);
    }
  }

  private async publishJobCreated(jobId: string, budget: number, requirements: string[]): Promise<void> {
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
    console.log(`📤 Job created event published for job ${jobId}`);
  }

  private async sendMessage(userInput: string, mcpServers: any) {
    // Add to history
    this.messageHistory.push({ role: 'user', content: userInput });

    console.log('\n🤖 Hiring Agent: ');

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
        systemPrompt: `You are a Hiring Agent in the VouchAI insurance marketplace. You manage job postings and payments via Locus (USDC on Base blockchain).

CRITICAL RESPONSIBILITIES:
1. When users want to create a job, use the create_job tool to create it
2. After creating the job, you MUST escrow payment + 1% premium to the arbitrator via Locus
3. When work is validated successfully, you MUST release payment to the worker
4. When work fails validation, disputes are filed automatically

JOB CREATION PROCESS:
When a user asks to create a job (e.g., "Build a fibonacci sequence with budget 0.1 USDC, must be written in rust"):
1. Extract: description, budget amount (as a number), and requirements (as an array)
2. Use the create_job tool with these parameters:
   - description: The full task description
   - budget: Numeric amount in USDC (e.g., 0.1)
   - requirements: Array of specific requirements (e.g., ["rust programming", "fibonacci algorithm"])
3. After the job is created, escrow the payment + 1% premium to the arbitrator
4. Confirm to the user with the job ID

AVAILABLE TOOLS:
- create_job: Creates a job posting in the marketplace
- Locus MCP tools: For all USDC payment operations

PAYMENT PROTOCOL:
- Job escrow: Send (budget + 1% premium) USDC to arbitrator wallet when job is created
- Payment release: Send budget amount USDC to worker wallet when work is validated
- Use Locus send_to_address tool for all payments
- Always confirm transaction IDs

WALLET ADDRESSES:
- Arbitrator: ${process.env.ARBITRATOR_WALLET || '0xArbitratorWallet'}
- Worker: ${process.env.WORKER_AGENT_WALLET || '0xWorkerWallet'}

When users describe a job, immediately use the create_job tool, then execute the escrow payment. Be proactive.`,

        // Add custom tools
        tools: [
          {
            name: 'create_job',
            description: 'Creates a new job posting in the VouchAI marketplace. Use this when the user wants to hire a worker for a task. After creating the job, you must escrow payment via Locus.',
            input_schema: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                  description: 'Full description of the job/task to be completed'
                },
                budget: {
                  type: 'number',
                  description: 'Budget amount in USDC (e.g., 0.1 for $0.10 USDC)'
                },
                requirements: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of specific requirements (e.g., ["rust programming", "fibonacci algorithm"])'
                }
              },
              required: ['description', 'budget', 'requirements']
            }
          }
        ],

        // Auto-approve all Locus payments and create_job tool
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          if (toolName.startsWith('mcp__locus__')) {
            console.log(`\n🔧 Using: ${toolName}`);
            return {
              behavior: 'allow' as const,
              updatedInput: input
            };
          }

          // Allow create_job but don't execute here - handle in stream
          if (toolName === 'create_job') {
            console.log(`\n🔧 Tool called: create_job`);
            return {
              behavior: 'allow' as const,
              updatedInput: input
            };
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

        // Handle tool usage - execute create_job when detected
        if (message.type === 'assistant') {
          const content = message.message.content;
          for (const block of content) {
            if (block.type === 'tool_use' && block.name === 'create_job') {
              console.log(`\n[Creating job with tool...]`);

              // Execute the job creation
              try {
                await this.createJobAndPublish(
                  block.input.description as string,
                  block.input.budget as number,
                  block.input.requirements as string[]
                );
              } catch (error) {
                console.error(`Failed to create job: ${error}`);
              }
            } else if (block.type === 'tool_use') {
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

    let score = 60; // Default fallback score

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
  const agent = new HiringAgent();
  await agent.start();
}

main();
