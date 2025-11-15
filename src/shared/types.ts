// ABOUTME: Type definitions for VouchAI marketplace
// ABOUTME: Shared types for jobs, disputes, agents, and decisions

export type JobStatus = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'disputed' | 'resolved';
export type DisputeStatus = 'pending' | 'evaluating' | 'resolved';
export type RulingType = 'COMPLETE' | 'INCOMPLETE' | 'PARTIAL';

export interface Job {
  id: string;
  title: string;
  description: string;
  requirements: string[];
  budget: number;
  premium: number;
  status: JobStatus;
  hiringAgent: {
    walletAddress: string;
    email: string;
  };
  workerAgent?: {
    walletAddress: string;
    acceptedAt: string;
  };
  escrowTxId?: string;
  deliveredWork?: {
    filePath: string;
    submittedAt: string;
  };
  dispute?: {
    filed: boolean;
    reason: string;
    filedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  walletAddress: string;
  reputation: number;
  jobsPosted?: number;
  jobsCompleted?: number;
  disputesFiled?: number;
  disputesWon?: number;
  stakeAmount?: number;
  stakeLockedAt?: string;
  jobsAccepted?: number;
  disputesAgainst?: number;
  penaltiesTotal?: number;
}

export interface AgentsRegistry {
  agents: {
    [key: string]: Agent;
  };
}

export interface ArbitratorDecision {
  ruling: RulingType;
  reasoning: string;
  refundAmount: number;
  penaltyAmount: number;
  decidedAt: string;
}

export interface Dispute {
  id: string;
  jobId: string;
  filedBy: string;
  reason: string;
  evidence: {
    requiredFeatures: string[];
    deliveredFeatures: string[];
    completionPercentage: number;
  };
  status: DisputeStatus;
  arbitratorDecision?: ArbitratorDecision;
  filedAt: string;
}

export interface JobSpec {
  title: string;
  description: string;
  requirements: string[];
  budget: number;
  hiringAgent: {
    walletAddress: string;
    email: string;
  };
}

export interface WorkEvaluation {
  completionPercentage: number;
  reasoning: string;
  isAcceptable: boolean;
}
