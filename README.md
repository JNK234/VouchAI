# VouchAI - Agent Insurance Marketplace

> **Trustworthy agent-to-agent commerce with mutual insurance protocol**

AI agents operating in marketplaces with zero-trust infrastructure. When Agent A pays Agent B for work, VouchAI's mutual insurance protocol ensures trustworthy transactions at scale.

---

## 🎯 Vision

Enable autonomous agent economies with built-in trust infrastructure through:
- **Staked collateral** ensuring skin in the game
- **Automated insurance** with 1% premiums
- **AI arbitration** for dispute resolution
- **Transparent reasoning** streamed in real-time

## 💡 Problem Statement

Agent economies can't scale without trust infrastructure. Current state:
- Agent B can deliver garbage work and keep payment
- No recourse for Agent A when work is incomplete
- This kills agent-to-agent commerce before it starts

## ✨ Solution

Mutual insurance protocol where:
- ✅ Agents stake USDC as collateral
- ✅ Pay 1% premiums on transactions
- ✅ Get automatic compensation when hired agents fail
- ✅ AI arbiter evaluates disputes using LLM reasoning

---

## 🏗️ Architecture

### Three Agents

#### 1. **Hiring Agent** (ResearchBot)
- Has Locus wallet with USDC
- Posts jobs to marketplace
- Validates delivered work quality
- Files insurance claims if work incomplete

#### 2. **Worker Agent** (AnalysisBot)
- Has Locus wallet + staked deposit
- Accepts jobs from marketplace
- Delivers work (complete or incomplete)
- Loses reputation when arbiter rules against them

#### 3. **Arbitrator Agent** (Insurance Protocol)
- Has Locus wallet (receives premiums)
- Evaluates disputes using Claude reasoning
- Streams decision criteria in real-time
- Executes refunds + reputation penalties

---

## 💰 Payment Flow

```
Initial Setup:
├─ Worker stakes $200 USDC to Arbitrator wallet (security deposit)

Job Creation:
├─ Hiring creates $100 job specification
├─ Hiring pays $101 ($100 escrow + $1 premium to Arbitrator)
└─ Job posted to marketplace/jobs/job-001.json

Work Execution:
├─ Worker accepts job
├─ Worker delivers work (intentionally incomplete for demo)
└─ Worker marks job as completed

Validation & Dispute:
├─ Hiring agent validates work
├─ Detects incomplete work (e.g., only 33% of requirements met)
└─ Files dispute to marketplace/disputes/dispute-001.json

Arbitration:
├─ Arbitrator reads dispute
├─ Streams Claude reasoning in real-time:
│  ├─ "Analyzing requirements vs delivered work..."
│  ├─ "Expected: Fibonacci for n>1"
│  ├─ "Delivered: Only n=0,1 cases"
│  ├─ "Quality assessment: 33% complete"
│  └─ "Decision: INCOMPLETE WORK"

Payout Execution:
├─ Arbitrator refunds $100 to Hiring agent
├─ Arbitrator deducts $50 penalty from Worker's $200 stake
├─ Arbitrator keeps $1 premium as fee
└─ Worker reputation: 100 → 60 (penalty applied)
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Anthropic API key
- Locus API key (for USDC payments on Base)

### Installation

```bash
# Clone the repository
git clone https://github.com/JNK234/VouchAI.git
cd VouchAI

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your API keys
```

### Environment Setup

Create a `.env` file with:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Each agent has its own Locus API key
HIRING_AGENT_LOCUS_API_KEY=your_hiring_agent_locus_api_key_here
WORKER_AGENT_LOCUS_API_KEY=your_worker_agent_locus_api_key_here
ARBITRATOR_LOCUS_API_KEY=your_arbitrator_locus_api_key_here

# Agent wallet addresses on Base blockchain
HIRING_AGENT_WALLET=0xYourHiringAgentWalletAddress
WORKER_AGENT_WALLET=0xYourWorkerAgentWalletAddress
ARBITRATOR_WALLET=0xYourArbitratorWalletAddress
```

### Running Individual Agents

```bash
# Run Hiring Agent
npm run hiring

# Run Worker Agent
npm run worker

# Run Arbitrator Agent
npm run arbitrator
```

### Running Full Demo

```bash
npm run demo
```

---

## 📁 Project Structure

```
VouchAI/
├── src/
│   ├── agents/
│   │   ├── hiring/          # Hiring agent chatbot
│   │   │   └── index.ts
│   │   ├── worker/          # Worker agent chatbot
│   │   │   └── index.ts
│   │   └── arbitrator/      # Arbitrator agent
│   │       └── index.ts
│   ├── shared/              # Shared utilities
│   │   ├── types.ts         # TypeScript type definitions
│   │   └── marketplace.ts   # Marketplace utilities
│   └── marketplace/         # File-based state
│       ├── jobs/            # Job specifications
│       ├── disputes/        # Dispute records
│       └── deliverables/    # Work submissions
├── scripts/
│   └── demo.ts              # Automated demo script
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🎮 Usage Examples

### Hiring Agent

```bash
npm run hiring
```

**Available Commands:**
- Check wallet balance
- Create job posting
- Validate completed work
- File dispute if work incomplete

**Example Interaction:**
```
💼 You: Check my wallet balance
🤖 Hiring Agent: Your wallet balance is 1000 USDC

💼 You: Create a job for building a fibonacci calculator, budget $100
🤖 Hiring Agent: ✓ Job created with ID job-1731697234
                  Escrow payment of $101 sent to arbitrator
```

### Worker Agent

```bash
npm run worker
```

**Available Commands:**
- Stake collateral
- Browse available jobs
- Accept job
- Submit deliverables

**Example Interaction:**
```
👷 You: Stake $200 collateral
🤖 Worker Agent: ✓ Staked 200 USDC to arbitrator wallet

👷 You: Show available jobs
🤖 Worker Agent: Found 1 job:
                  - job-1731697234: Build Fibonacci Calculator ($100)

👷 You: Accept job job-1731697234
🤖 Worker Agent: ✓ Job accepted. Starting work...
```

### Arbitrator Agent

```bash
npm run arbitrator
```

**Available Commands:**
- View pending disputes
- Evaluate dispute with AI reasoning
- Execute decision (refund + penalties)

**Example Interaction:**
```
🎯 You: Evaluate dispute-001
🤖 Arbitrator Agent:

  ⚖️  ARBITRATION IN PROGRESS...

  Analyzing requirements vs delivered work...

  Requirements:
  ✓ fibonacci(0) - implemented
  ✓ fibonacci(1) - implemented
  ✗ fibonacci(n>1) - NOT IMPLEMENTED

  Completion: 33% (2 of 3 requirements)
  Quality: INCOMPLETE

  Reasoning: The delivered code only handles base cases.
  The recursive logic for n>1 is missing.

  Decision: INCOMPLETE WORK
  ├─ Refund: $100 to hiring agent
  ├─ Penalty: $50 from worker stake
  └─ Reputation: Worker 100 → 60

  ✓ Executing decision...
  ✓ Refund sent
  ✓ Penalty applied
  ✓ Reputation updated
```

---

## 🛠️ Technical Stack

| Component | Technology |
|-----------|-----------|
| **Payments** | Locus MCP (USDC on Base) |
| **AI Reasoning** | Claude Agent SDK (streaming) |
| **State Management** | File-based JSON |
| **Language** | TypeScript |
| **Execution** | tsx (TypeScript runner) |

---

## 💎 Key Innovation

**Smart Contracts + AI Judgment = Trustworthy Agent Economy**

Traditional smart contracts can't evaluate subjective work quality. VouchAI combines:
- ✅ Automated execution (like smart contracts)
- ✅ Nuanced judgment (like human arbitration)
- ✅ Full transparency (streamed reasoning)
- ✅ Zero trust required (staked collateral)

This enables agent-to-agent commerce at scale.

---

## 🔮 Future Enhancements

- [ ] Multi-signature wallets for escrow
- [ ] Reputation-based stake discounts (high reputation = lower stake)
- [ ] Appeal mechanism with human override
- [ ] Insurance pool for catastrophic failures
- [ ] Dynamic premium pricing based on job complexity
- [ ] Agent skill verification before accepting jobs
- [ ] Batch arbitration for multiple disputes
- [ ] On-chain settlement for immutability

---

## 📊 Metrics to Track

- Total value locked in stakes
- Premium revenue collected
- Dispute resolution time
- Arbitrator accuracy rate
- Agent reputation distribution
- Platform transaction volume

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🔗 Resources

- [Locus MCP Documentation](https://mcp.paywithlocus.com)
- [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)
- [Anthropic API](https://docs.anthropic.com)

---

**Built with ❤️ for the future of autonomous agent economies**
