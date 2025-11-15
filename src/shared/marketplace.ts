// ABOUTME: Marketplace utilities for job and dispute management
// ABOUTME: File-based state management for VouchAI protocol

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Job, JobSpec, JobStatus, Dispute, AgentsRegistry } from './types.js';

const MARKETPLACE_DIR = 'src/marketplace';
const JOBS_DIR = join(MARKETPLACE_DIR, 'jobs');
const DISPUTES_DIR = join(MARKETPLACE_DIR, 'disputes');
const DELIVERABLES_DIR = join(MARKETPLACE_DIR, 'deliverables');
const AGENTS_FILE = join(MARKETPLACE_DIR, 'agents.json');

// Ensure directories exist
export async function initMarketplace(): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(DISPUTES_DIR, { recursive: true });
  await mkdir(DELIVERABLES_DIR, { recursive: true });

  // Initialize agents file if it doesn't exist
  try {
    await readFile(AGENTS_FILE, 'utf-8');
  } catch {
    const initialAgents: AgentsRegistry = {
      agents: {
        'hiring-agent': {
          walletAddress: '0xHiring123',
          reputation: 100,
          jobsPosted: 0,
          jobsCompleted: 0,
          disputesFiled: 0,
          disputesWon: 0
        },
        'worker-agent': {
          walletAddress: '0xWorker456',
          reputation: 100,
          stakeAmount: 0,
          jobsAccepted: 0,
          jobsCompleted: 0,
          disputesAgainst: 0,
          penaltiesTotal: 0
        }
      }
    };
    await writeFile(AGENTS_FILE, JSON.stringify(initialAgents, null, 2));
  }
}

// Job Management
export async function createJob(spec: JobSpec): Promise<string> {
  const jobId = `job-${Date.now()}`;
  const job: Job = {
    id: jobId,
    ...spec,
    premium: spec.budget * 0.01, // 1% premium
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const jobPath = join(JOBS_DIR, `${jobId}.json`);
  await writeFile(jobPath, JSON.stringify(job, null, 2));
  return jobId;
}

export async function readJob(jobId: string): Promise<Job> {
  const jobPath = join(JOBS_DIR, `${jobId}.json`);
  const content = await readFile(jobPath, 'utf-8');
  return JSON.parse(content);
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

  const jobPath = join(JOBS_DIR, `${jobId}.json`);
  await writeFile(jobPath, JSON.stringify(job, null, 2));
}

export async function listJobs(): Promise<Job[]> {
  const { readdir } = await import('fs/promises');
  const files = await readdir(JOBS_DIR);
  const jobs: Job[] = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      const jobId = file.replace('.json', '');
      jobs.push(await readJob(jobId));
    }
  }

  return jobs;
}

// Dispute Management
export async function fileDispute(
  jobId: string,
  filedBy: string,
  reason: string,
  evidence: any
): Promise<string> {
  const disputeId = `dispute-${Date.now()}`;
  const dispute: Dispute = {
    id: disputeId,
    jobId,
    filedBy,
    reason,
    evidence,
    status: 'pending',
    filedAt: new Date().toISOString()
  };

  const disputePath = join(DISPUTES_DIR, `${disputeId}.json`);
  await writeFile(disputePath, JSON.stringify(dispute, null, 2));

  // Update job with dispute info
  await updateJobStatus(jobId, 'disputed', {
    dispute: {
      filed: true,
      reason,
      filedAt: new Date().toISOString()
    }
  });

  return disputeId;
}

export async function readDispute(disputeId: string): Promise<Dispute> {
  const disputePath = join(DISPUTES_DIR, `${disputeId}.json`);
  const content = await readFile(disputePath, 'utf-8');
  return JSON.parse(content);
}

export async function updateDispute(
  disputeId: string,
  updates: Partial<Dispute>
): Promise<void> {
  const dispute = await readDispute(disputeId);
  Object.assign(dispute, updates);

  const disputePath = join(DISPUTES_DIR, `${disputeId}.json`);
  await writeFile(disputePath, JSON.stringify(dispute, null, 2));
}

// Agent Management
export async function readAgents(): Promise<AgentsRegistry> {
  const content = await readFile(AGENTS_FILE, 'utf-8');
  return JSON.parse(content);
}

export async function updateReputation(
  agentKey: string,
  delta: number
): Promise<void> {
  const agents = await readAgents();
  const agent = agents.agents[agentKey];

  if (agent) {
    agent.reputation = Math.max(0, Math.min(100, agent.reputation + delta));
    await writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2));
  }
}

export async function updateWorkerStake(
  agentKey: string,
  delta: number
): Promise<void> {
  const agents = await readAgents();
  const agent = agents.agents[agentKey];

  if (agent && agent.stakeAmount !== undefined) {
    agent.stakeAmount = Math.max(0, agent.stakeAmount + delta);
    if (delta < 0) {
      agent.penaltiesTotal = (agent.penaltiesTotal || 0) + Math.abs(delta);
    }
    await writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2));
  }
}

// Deliverables Management
export async function saveDeliverable(
  jobId: string,
  fileName: string,
  content: string
): Promise<string> {
  const deliverableDir = join(DELIVERABLES_DIR, jobId);
  await mkdir(deliverableDir, { recursive: true });

  const filePath = join(deliverableDir, fileName);
  await writeFile(filePath, content);

  return filePath;
}

export async function readDeliverable(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf-8');
}
