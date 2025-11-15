// ABOUTME: Hiring Agent chatbot for managing payments and jobs via Locus
// ABOUTME: Uses Claude Agent SDK with proper streaming and session management

import 'dotenv/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

class HiringAgent {
  private sessionId?: string;
  private rl: readline.Interface;
  private messageHistory: ChatMessage[] = [];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n💼 You: '
    });
  }

  async start() {
    console.log('💼 HIRING AGENT CHATBOT\n');
    console.log('I can help you manage payments and jobs via Locus.\n');
    console.log('Commands: /history, /clear, /exit\n');

    // Configure MCP connection to Locus
    const mcpServers = {
      'locus': {
        type: 'http' as const,
        url: 'https://mcp.paywithlocus.com/mcp',
        headers: {
          'Authorization': `Bearer ${process.env.LOCUS_API_KEY}`
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
      process.exit(0);
    });
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
        systemPrompt: `You are a Hiring Agent chatbot that manages payments via Locus.

Available commands:
- Check wallet balance
- Send money to worker agents
- Create job postings
- Validate completed work

Be helpful and execute payment commands when asked.`,
        // Auto-approve all Locus payments
        canUseTool: async (toolName: string, input: Record<string, unknown>) => {
          if (toolName.startsWith('mcp__locus__')) {
            console.log(`\n🔧 Using: ${toolName}`);
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
  const agent = new HiringAgent();
  await agent.start();
}

main();
