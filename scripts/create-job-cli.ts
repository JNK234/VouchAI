#!/usr/bin/env tsx
// Quick CLI script to create a job and return the details

import { initMarketplace, createJob } from '../src/shared/marketplace.js';

async function main() {
  const description = process.argv[2] || 'Build a fibonacci sequence with budget 0.1 USDC, must be written in rust';
  const budget = parseFloat(process.argv[3] || '0.1');
  const requirements = process.argv.slice(4);

  if (requirements.length === 0) {
    requirements.push('rust programming', 'fibonacci algorithm');
  }

  await initMarketplace();

  const jobSpec = {
    title: description.substring(0, 50),
    description,
    requirements,
    budget,
    hiringAgent: {
      walletAddress: '0x9a9f111519a947b8150822dd6efab1afd3658b0f', // Hiring agent (from system prompt)
      email: 'hiring@vouchai.com'
    }
  };

  const jobId = await createJob(jobSpec);
  const premium = budget * 0.01;
  const totalEscrow = budget + premium;

  console.log(JSON.stringify({
    success: true,
    jobId,
    budget,
    premium,
    totalEscrow,
    arbitratorWallet: '0x9a9f111519a947b8150822dd6efab1afd3658b0f'
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
