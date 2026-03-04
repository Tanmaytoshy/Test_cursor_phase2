export interface Job {
  status: 'running' | 'complete' | 'error';
  card_id: string;
  card_name: string;
  started_at: number;
  public_links?: string[];
  error?: string;
  finished_at?: number;
}

// In-memory store — works perfectly on Railway's persistent server
const jobs = new Map<string, Job>();

export function createJob(jobId: string, card_id: string, card_name: string): Job {
  const job: Job = {
    status: 'running',
    card_id,
    card_name,
    started_at: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function updateJob(jobId: string, updates: Partial<Job>): void {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, updates);
}
