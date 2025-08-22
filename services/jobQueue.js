const { randomUUID } = require('crypto');

const jobs = new Map();

function createJob({ titleId, quantity }) {
  const id = randomUUID();
  const job = {
    id,
    titleId,
    quantity,
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    total: quantity,
    completed: 0,
    failed: 0,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function startJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  job.status = 'running';
  job.startedAt = new Date().toISOString();
  return job;
}

function incrementCompleted(id) {
  const job = jobs.get(id);
  if (!job) return null;
  job.completed += 1;
  return job;
}

function incrementFailed(id) {
  const job = jobs.get(id);
  if (!job) return null;
  job.failed += 1;
  return job;
}

function completeJob(id) {
  const job = jobs.get(id);
  if (!job) return null;
  job.status = 'completed';
  job.finishedAt = new Date().toISOString();
  return job;
}

function failJob(id, error) {
  const job = jobs.get(id);
  if (!job) return null;
  job.status = 'failed';
  job.error = String(error?.message || error);
  job.finishedAt = new Date().toISOString();
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

module.exports = {
  createJob,
  startJob,
  incrementCompleted,
  incrementFailed,
  completeJob,
  failJob,
  getJob,
};


