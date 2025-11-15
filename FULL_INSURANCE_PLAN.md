# Agent Insurance Marketplace - Full Implementation Plan

## Vision
AI agents operating in agent marketplaces with zero-trust infrastructure. When Agent A pays Agent B for work, mutual insurance protocol ensures trustworthy transactions at scale.

## Problem Statement
Agent economies can't scale without trust infrastructure. Current state: Agent B can deliver garbage work and keep payment. This kills agent-to-agent commerce before it starts.

## Solution
Mutual insurance protocol where:
- Agents stake USDC as collateral
- Pay 1% premiums on transactions
- Get automatic compensation when hired agents fail
- AI arbiter evaluates disputes using LLM reasoning

## Architecture

### Three Agents

**1. Hiring Agent (ResearchBot)**
- Has Locus wallet with USDC
- Posts jobs to marketplace
- Validates delivered work quality
- Files insurance claims if work incomplete

**2. Worker Agent (AnalysisBot)**
- Has Locus wallet + staked deposit
- Accepts jobs from marketplace
- Delivers work (complete or incomplete)
- Loses reputation when arbiter rules against them

**3. Arbitrator Agent (Insurance Protocol)**
- Has Locus wallet (receives premiums)
- Evaluates disputes using Claude reasoning
- Streams decision criteria in real-time
- Executes refunds + reputation penalties

### Payment Flow

```
Initial Setup:
- Worker stakes $200 USDC to Arbitrator wallet (security deposit)

Job Creation:
- Hiring creates $100 job specification
- Hiring pays $101 ($100 escrow + $1 premium to Arbitrator)
- Job posted to marketplace/jobs/job-001.json

Work Execution:
- Worker accepts job
- Worker delivers work (intentionally incomplete for demo)
- Worker marks job as completed

Validation & Dispute:
- Hiring agent validates work
- Detects incomplete work (e.g., only 33% of requirements met)
- Files dispute to marketplace/disputes/dispute-001.json

Arbitration:
- Arbitrator reads dispute
- Streams Claude reasoning in real-time:
  * "Analyzing requirements vs delivered work..."
  * "Expected: Fibonacci for n>1"
  * "Delivered: Only n=0,1 cases"
  * "Quality assessment: 33% complete"
  * "Decision: INCOMPLETE WORK"

Payout Execution:
- Arbitrator refunds $100 to Hiring agent
- Arbitrator deducts $50 penalty from Worker's $200 stake
- Arbitrator keeps $1 premium as fee
- Worker reputation: 100 → 60 (penalty applied)
```

## Technical Implementation

### State Management (File-Based)

**marketplace/jobs/job-{id}.json**
```json
{
  "id": "job-001",
  "title": "Build Fibonacci Calculator",
  "description": "Python script that calculates fibonacci sequence",
  "requirements": [
    "Handle n >= 0",
    "Return correct fibonacci number",
    "Include error handling"
  ],
  "budget": 100,
  "premium": 1,
  "status": "pending|accepted|in_progress|completed|disputed|resolved",
  "hiringAgent": {
    "walletAddress": "0x...",
    "email": "hiring@example.com"
  },
  "workerAgent": {
    "walletAddress": "0x...",
    "acceptedAt": "2025-11-15T15:00:00Z"
  },
  "escrowTxId": "locus_tx_...",
  "deliveredWork": {
    "filePath": "marketplace/deliverables/fibonacci.py",
    "submittedAt": "2025-11-15T16:00:00Z"
  },
  "dispute": {
    "filed": true,
    "reason": "Incomplete implementation",
    "filedAt": "2025-11-15T16:30:00Z"
  },
  "createdAt": "2025-11-15T14:00:00Z",
  "updatedAt": "2025-11-15T16:30:00Z"
}
```

**marketplace/agents.json**
```json
{
  "agents": {
    "hiring-agent": {
      "walletAddress": "0xHiring...",
      "reputation": 100,
      "jobsPosted": 5,
      "jobsCompleted": 4,
      "disputesFiled": 1,
      "disputesWon": 1
    },
    "worker-agent": {
      "walletAddress": "0xWorker...",
      "reputation": 60,
      "stakeAmount": 150,
      "stakeLockedAt": "2025-11-15T10:00:00Z",
      "jobsAccepted": 3,
      "jobsCompleted": 2,
      "disputesAgainst": 1,
      "penaltiesTotal": 50
    }
  }
}
```

**marketplace/disputes/dispute-{id}.json**
```json
{
  "id": "dispute-001",
  "jobId": "job-001",
  "filedBy": "hiring-agent",
  "reason": "Work does not meet requirements - only handles base cases",
  "evidence": {
    "requiredFeatures": ["fibonacci(n) for n>1"],
    "deliveredFeatures": ["fibonacci(0)", "fibonacci(1)"],
    "completionPercentage": 33
  },
  "status": "pending|evaluating|resolved",
  "arbitratorDecision": {
    "ruling": "INCOMPLETE",
    "reasoning": "Delivered work only implements 33% of requirements...",
    "refundAmount": 100,
    "penaltyAmount": 50,
    "decidedAt": "2025-11-15T17:00:00Z"
  },
  "filedAt": "2025-11-15T16:30:00Z"
}
```

### Agent Implementation Details

#### Hiring Agent (hiring-agent/index.ts)

**Key Functions:**
1. `createJob(spec)` - Create job specification
2. `payForJob(jobId, amount)` - Send payment to escrow
3. `validateWork(jobId)` - Check delivered work quality
4. `fileDispute(jobId, reason)` - Create dispute if work bad

**Locus Tools Used:**
- `get_payment_context` - Check wallet balance
- `send_to_address` - Pay escrow + premium to arbitrator

**Validation Logic:**
```typescript
async function validateWork(jobId: string): Promise<boolean> {
  const job = await readJob(jobId);
  const deliveredFile = await readFile(job.deliveredWork.filePath);

  // Use Claude to evaluate work quality
  const evaluation = await query({
    prompt: `
      Evaluate this work against requirements:

      Requirements: ${JSON.stringify(job.requirements)}
      Delivered: ${deliveredFile}

      Rate completion percentage and quality.
    `,
    options: { model: "claude-sonnet-4-5" }
  });

  // If < 80% complete, file dispute
  if (evaluation.completionPercentage < 80) {
    await fileDispute(jobId, evaluation.reasoning);
    return false;
  }

  return true;
}
```

#### Worker Agent (worker-agent/index.ts)

**Key Functions:**
1. `stakeCollateral(amount)` - Send stake to arbitrator
2. `findJobs()` - Read pending jobs from marketplace
3. `acceptJob(jobId)` - Claim job and update status
4. `deliverWork(jobId, workPath)` - Submit completed work

**Work Delivery (Intentionally Incomplete for Demo):**
```typescript
async function deliverWork(jobId: string) {
  // Create incomplete fibonacci.py
  const incompleteFib = `
def fibonacci(n):
    if n == 0:
        return 0
    elif n == 1:
        return 1
    # TODO: Handle n > 1 cases
    else:
        raise NotImplementedError("Only base cases implemented")
  `;

  const deliveryPath = `marketplace/deliverables/${jobId}/fibonacci.py`;
  await writeFile(deliveryPath, incompleteFib);

  await updateJobStatus(jobId, 'completed', {
    deliveredWork: {
      filePath: deliveryPath,
      submittedAt: new Date().toISOString()
    }
  });
}
```

#### Arbitrator Agent (arbitrator-agent/index.ts)

**Key Functions:**
1. `receiveStake(from, amount)` - Track worker stakes
2. `receiveEscrow(jobId, amount)` - Hold job payment
3. `evaluateDispute(disputeId)` - AI-powered work evaluation
4. `executeDecision(disputeId)` - Send refunds/penalties

**Streaming Evaluation:**
```typescript
async function evaluateDispute(disputeId: string) {
  const dispute = await readDispute(disputeId);
  const job = await readJob(dispute.jobId);
  const deliveredWork = await readFile(job.deliveredWork.filePath);

  console.log('\n⚖️  ARBITRATOR EVALUATING DISPUTE...\n');

  const response = query({
    prompt: `
      You are an AI arbitrator evaluating work quality.

      Job Requirements:
      ${JSON.stringify(job.requirements, null, 2)}

      Delivered Work:
      ${deliveredWork}

      Dispute Reason:
      ${dispute.reason}

      Evaluate:
      1. Completion percentage (0-100%)
      2. Quality assessment
      3. Ruling: COMPLETE, INCOMPLETE, or PARTIAL
      4. Recommended refund amount
      5. Recommended penalty amount

      Explain your reasoning step-by-step.
    `,
    options: {
      model: "claude-sonnet-4-5",
      includePartialMessages: true  // Stream reasoning!
    }
  });

  // Stream Claude's reasoning in real-time
  for await (const message of response) {
    if (message.type === 'partial_assistant') {
      process.stdout.write(message.delta.text || '');
    } else if (message.type === 'result') {
      const decision = parseArbitratorDecision(message.result);
      await executeDecision(disputeId, decision);
    }
  }
}
```

**Decision Execution:**
```typescript
async function executeDecision(disputeId: string, decision: Decision) {
  const dispute = await readDispute(disputeId);
  const job = await readJob(dispute.jobId);

  // 1. Refund hiring agent
  if (decision.refundAmount > 0) {
    await locusSendToAddress(
      job.hiringAgent.walletAddress,
      decision.refundAmount,
      `Refund for dispute ${disputeId}`
    );
  }

  // 2. Deduct penalty from worker stake
  if (decision.penaltyAmount > 0) {
    await updateWorkerStake(
      job.workerAgent.walletAddress,
      -decision.penaltyAmount
    );
  }

  // 3. Update reputation
  await updateReputation(job.workerAgent.walletAddress, -40);

  // 4. Save decision
  await updateDispute(disputeId, {
    status: 'resolved',
    arbitratorDecision: decision
  });
}
```

### Shared Utilities (marketplace/utils.ts)

```typescript
export async function createJob(spec: JobSpec): Promise<string> {
  const jobId = `job-${Date.now()}`;
  const jobPath = `marketplace/jobs/${jobId}.json`;
  await writeFile(jobPath, JSON.stringify(spec, null, 2));
  return jobId;
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  updates?: Partial<Job>
): Promise<void> {
  const job = await readJob(jobId);
  job.status = status;
  job.updatedAt = new Date().toISOString();
  Object.assign(job, updates);
  await writeFile(`marketplace/jobs/${jobId}.json`, JSON.stringify(job, null, 2));
}

export async function fileDispute(
  jobId: string,
  reason: string,
  evidence: any
): Promise<string> {
  const disputeId = `dispute-${Date.now()}`;
  const dispute = {
    id: disputeId,
    jobId,
    filedBy: 'hiring-agent',
    reason,
    evidence,
    status: 'pending',
    filedAt: new Date().toISOString()
  };
  await writeFile(`marketplace/disputes/${disputeId}.json`, JSON.stringify(dispute, null, 2));
  return disputeId;
}

export async function updateReputation(
  agentWallet: string,
  delta: number
): Promise<void> {
  const agents = await readAgents();
  const agent = Object.values(agents.agents).find(a => a.walletAddress === agentWallet);
  if (agent) {
    agent.reputation = Math.max(0, Math.min(100, agent.reputation + delta));
    await writeFile('marketplace/agents.json', JSON.stringify(agents, null, 2));
  }
}
```

## Demo Flow Script (run-demo.ts)

```typescript
import { spawn } from 'child_process';

async function runDemo() {
  console.log('🎬 STARTING AGENT INSURANCE DEMO\n');

  // Step 1: Worker stakes collateral
  console.log('📍 Step 1: Worker staking $200 collateral...');
  await runAgent('worker-agent', ['stake']);
  await sleep(2000);

  // Step 2: Hiring creates job and pays escrow
  console.log('\n📍 Step 2: Hiring agent creating $100 job...');
  await runAgent('hiring-agent', ['create-job']);
  await sleep(2000);

  // Step 3: Worker accepts and delivers incomplete work
  console.log('\n📍 Step 3: Worker accepting job and delivering work...');
  await runAgent('worker-agent', ['accept-job', 'job-001']);
  await sleep(3000);

  // Step 4: Hiring validates and files dispute
  console.log('\n📍 Step 4: Hiring agent validating work...');
  await runAgent('hiring-agent', ['validate', 'job-001']);
  await sleep(2000);

  // Step 5: Arbitrator evaluates and decides
  console.log('\n📍 Step 5: Arbitrator evaluating dispute...');
  console.log('━'.repeat(60));
  await runAgent('arbitrator-agent', ['evaluate', 'dispute-001']);
  await sleep(5000);

  // Step 6: Show final state
  console.log('\n📍 Step 6: Final state:');
  await showFinalState();
}

function runAgent(agent: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('npm', ['start', '--', ...args], {
      cwd: agent,
      stdio: 'inherit'
    });
    proc.on('close', () => resolve());
  });
}
```

## Live Demo Presentation (3 Minutes)

### Minute 1: Setup
- Show 3 terminal windows (Hiring, Worker, Arbitrator)
- Display initial balances
- Worker stakes $200
- Hiring creates $100 job + pays $101

### Minute 2: Transaction & Dispute
- Worker accepts job
- Worker delivers incomplete fibonacci.py
- Hiring validates, detects incompleteness
- Files dispute

### Minute 3: AI Arbitration
- **Focus on Arbitrator terminal**
- Watch Claude stream reasoning in real-time:
  ```
  Evaluating dispute-001...

  Requirements analysis:
  ✓ fibonacci(0) - implemented
  ✓ fibonacci(1) - implemented
  ✗ fibonacci(n>1) - NOT IMPLEMENTED

  Completion: 33% (2 of 3 requirements)
  Quality: INCOMPLETE

  Reasoning: The delivered code only handles base cases...

  Decision: REFUND hiring agent, PENALIZE worker
  Refund: $100 to hiring agent
  Penalty: $50 from worker stake
  Reputation: Worker 100 → 60

  Executing decision...
  ✓ Refund sent
  ✓ Penalty applied
  ✓ Reputation updated
  ```

### Demo Conclusion
- Show final balances
- Show reputation scores
- Emphasize: **Fully autonomous, zero human intervention**
- Highlight: **AI reasoning visible + trustworthy**

## Technical Stack Summary

- **Payments**: Locus MCP (USDC on Base)
- **AI Reasoning**: Claude Agent SDK (streaming)
- **State Management**: File-based JSON
- **Language**: TypeScript
- **Execution**: tsx (TypeScript runner)

## Key Innovation

**Smart Contracts + AI Judgment = Trustworthy Agent Economy**

Traditional smart contracts can't evaluate subjective work quality. Our system combines:
- Automated execution (like smart contracts)
- Nuanced judgment (like human arbitration)
- Full transparency (streamed reasoning)
- Zero trust required (staked collateral)

This enables agent-to-agent commerce at scale.

## Future Enhancements

1. **Multi-signature wallets** for escrow
2. **Reputation-based stake discounts** (high reputation = lower stake)
3. **Appeal mechanism** with human override
4. **Insurance pool** for catastrophic failures
5. **Dynamic premium pricing** based on job complexity
6. **Agent skill verification** before accepting jobs
7. **Batch arbitration** for multiple disputes
8. **On-chain settlement** for immutability

## Metrics to Track

- Total value locked in stakes
- Premium revenue collected
- Dispute resolution time
- Arbitrator accuracy rate
- Agent reputation distribution
- Platform transaction volume

---

**This plan demonstrates the future of autonomous agent economies with built-in trust infrastructure.**
