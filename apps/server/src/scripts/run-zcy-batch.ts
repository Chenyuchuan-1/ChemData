import { startZcyBatch, getBatchJob } from "../services/batch.js";

const sourceDir = process.argv[2];
const jobId = startZcyBatch(sourceDir);
console.log(JSON.stringify({ job_id: jobId, source_dir: sourceDir ?? "zcy" }));

const timer = setInterval(() => {
  const job = getBatchJob(jobId);
  if (!job) return;
  const current =
    job.summary && typeof job.summary === "object" ? (job.summary as { current?: string }).current : undefined;
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      status: job.status,
      progress: job.progress,
      current,
      error: job.error,
    }),
  );
  if (job.status === "completed" || job.status === "failed") {
    clearInterval(timer);
    process.exit(job.status === "completed" ? 0 : 1);
  }
}, 15000);
