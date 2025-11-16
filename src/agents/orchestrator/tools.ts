// ABOUTME: Tool registry for orchestrator - defines all available capabilities
// ABOUTME: Maps tools to handlers and provides orchestrator with knowledge of what it can do

import * as marketplace from '../../shared/marketplace.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  handler?: (params: any) => Promise<any>;
  mcpTool?: string;
}

/**
 * Registry of all tools available to the orchestrator.
 * This gives the orchestrator knowledge of its capabilities.
 */
export const ORCHESTRATOR_TOOLS: Record<string, ToolDefinition> = {
  create_job: {
    name: 'create_job',
    description: 'Create a new job posting in the VouchAI marketplace. Use this when the user wants to hire someone or create work.',
    parameters: {
      description: {
        type: 'string',
        description: 'Clear description of what needs to be done',
        required: true
      },
      budget: {
        type: 'number',
        description: 'Budget in USDC for the job',
        required: true
      },
      requirements: {
        type: 'array',
        description: 'List of specific requirements (e.g., ["Must use TypeScript", "Include tests"])',
        required: true
      }
    },
    handler: async (params: { description: string; budget: number; requirements: string[] }) => {
      // This will be called by the orchestrator's createJobAndExecuteWorkflow method
      return {
        action: 'create_job',
        params
      };
    }
  },

  check_job_status: {
    name: 'check_job_status',
    description: 'Query the status of a specific job or list all active jobs. Use when user asks "what\'s happening" or "show my jobs".',
    parameters: {
      jobId: {
        type: 'string',
        description: 'Optional job ID to check specific job. If not provided, lists all active jobs.',
        required: false
      }
    },
    handler: async (params: { jobId?: string }) => {
      await marketplace.initMarketplace();

      if (params.jobId) {
        const job = await marketplace.readJob(params.jobId);
        return {
          jobId: job.id,
          description: job.description,
          budget: job.budget,
          status: job.status,
          createdAt: job.createdAt
        };
      } else {
        // List all jobs (simplified - in production, filter by user)
        return {
          message: 'Use /status command to see all active jobs in this session'
        };
      }
    }
  },

  check_balance: {
    name: 'check_balance',
    description: 'Check USDC balance for an agent wallet. Use when user asks about balance or available funds.',
    parameters: {
      walletAddress: {
        type: 'string',
        description: 'Wallet address to check (defaults to hiring agent wallet)',
        required: false
      }
    },
    mcpTool: 'mcp__locus__get_balance'
  },

  explain_system: {
    name: 'explain_system',
    description: 'Explain how VouchAI works. Use when user asks "how does this work" or wants to understand the system.',
    parameters: {},
    handler: async () => {
      return {
        explanation: `VouchAI is an agent-powered marketplace with three key agents:

1. **Hiring Agent** - Validates submitted work using AI
2. **Worker Agent** - Automatically accepts jobs and generates deliverables with AI
3. **Arbitrator Agent** - Resolves disputes and releases payments from escrow

**Workflow:**
- You create a job with a budget (USDC on Base)
- System puts budget + 1% premium into escrow
- Worker agent accepts and completes the job automatically
- Hiring agent validates work quality (must score ≥70%)
- If approved: Arbitrator releases payment to worker
- If disputed: Arbitrator reviews and decides on refunds/penalties

All payments use Locus for USDC transfers on Base network.`
      };
    }
  }
};

/**
 * Get all tool names for Claude's allowedTools parameter
 */
export function getToolNames(): string[] {
  return Object.keys(ORCHESTRATOR_TOOLS);
}

/**
 * Get tool definitions in a format suitable for system prompts
 */
export function getToolDescriptions(): string {
  return Object.entries(ORCHESTRATOR_TOOLS)
    .map(([name, tool]) => `- ${name}: ${tool.description}`)
    .join('\n');
}

/**
 * Execute a tool by name with parameters
 */
export async function executeTool(toolName: string, params: any): Promise<any> {
  const tool = ORCHESTRATOR_TOOLS[toolName];

  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  if (tool.handler) {
    return await tool.handler(params);
  }

  if (tool.mcpTool) {
    // MCP tools are handled by Claude Agent SDK directly
    return {
      mcpTool: tool.mcpTool,
      params
    };
  }

  throw new Error(`Tool ${toolName} has no handler or MCP mapping`);
}
