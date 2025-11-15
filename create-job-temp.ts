import * as marketplace from './src/shared/marketplace.js';

async function createJob() {
  await marketplace.initMarketplace();

  const jobSpec = {
    title: 'Implement Fibonacci sequence in Rust',
    description: 'Implement a Fibonacci sequence in Rust',
    requirements: ['Rust programming', 'Fibonacci algorithm implementation'],
    budget: 0.2,
    hiringAgent: {
      walletAddress: '0x9a9f111519a947b8150822dd6efab1afd3658b0f',
      email: 'hiring@vouchai.com'
    }
  };

  const jobId = await marketplace.createJob(jobSpec);
  console.log(jobId);
}

createJob();
