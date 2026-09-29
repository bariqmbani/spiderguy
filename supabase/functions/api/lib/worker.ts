import { chunkText, decodeUtf8Strict, normalizeText } from "../shared/chunk.ts";
import { admin, HttpError } from "./core.ts";
import { embed, toVectorLiteral } from "./providers.ts";

type Job = {
  job_id: string; fence: number; attempts: number; workspace_id: string; source_id: string; revision_id: string;
  source_kind: string; storage_path: string | null; extracted_text: string | null; external_file_id: string | null;
  connection_id: string | null; actor_id: string;
};

class JobError extends Error {
  constructor(public code: string, public retryable: boolean) {
    super(code);
  }
}

const MAX_CHARS = 100_000;
const MAX_BYTES = 5 * 1024 * 1024;
const BATCH = 16;

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    if (error.message?.includes("STALE_FENCE")) throw new JobError("STALE_FENCE", false);
    throw new JobError("DATABASE_ERROR", true);
  }
  return data;
}

async function extract(job: Job): Promise<string> {
  if (job.source_kind !== "upload") return job.extracted_text ?? "";
  if (!job.storage_path) throw new JobError("UPLOAD_MISSING", false);
  const { data, error } = await admin.storage.from("uploads").download(job.storage_path);
  if (error || !data) throw new JobError("UPLOAD_MISSING", false);
  if (data.size > MAX_BYTES) throw new JobError("TOO_LARGE", false);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.includes(0)) throw new JobError("BINARY_CONTENT", false);
  const text = decodeUtf8Strict(bytes);
  if (text === null) throw new JobError("INVALID_UTF8", false);
  const norm = normalizeText(text);
  if (norm.length > MAX_CHARS) throw new JobError("TOO_MANY_CHARACTERS", false);
  await rpc("worker_store_text", { p_job_id: job.job_id, p_fence: job.fence, p_text: norm });
  return norm;
}

async function processJob(job: Job, deadline: number): Promise<string> {
  const text = normalizeText(await extract(job));
  if (!text) throw new JobError("EMPTY_CONTENT", false);
  const chunks = chunkText(text);
  if (!chunks.length) throw new JobError("EMPTY_CONTENT", false);
  for (let i = 0; i < chunks.length; i += BATCH) {
    if (Date.now() > deadline) throw new JobError("DEADLINE", true);
    const batch = chunks.slice(i, i + BATCH);
    let vectors: number[][];
    try {
      vectors = await embed(batch);
    } catch (e) {
      const he = e as HttpError;
      throw new JobError(he.code === "PROVIDER_INVALID" && !he.retryable ? "EMBEDDING_INVALID" : "EMBEDDING_UNAVAILABLE", he.retryable ?? true);
    }
    await rpc("worker_put_chunks", {
      p_job_id: job.job_id,
      p_fence: job.fence,
      p_chunks: batch.map((t, k) => ({ ordinal: i + k, text: t, embedding: toVectorLiteral(vectors[k]) })),
    });
  }
  return await rpc("worker_activate", { p_job_id: job.job_id, p_fence: job.fence, p_chunk_count: chunks.length }) as string;
}

/** One bounded worker pass. At-least-once: activation is fenced and transactional in Postgres. */
export async function runWorker(maxJobs = 8, budgetMs = 40_000) {
  const deadline = Date.now() + budgetMs;
  const counts = { processed: 0, ready: 0, retried: 0, failed: 0, stale: 0 };
  while (counts.processed < maxJobs && Date.now() < deadline - 5000) {
    const { data, error } = await admin.rpc("worker_claim_jobs", { p_limit: Math.min(4, maxJobs - counts.processed), p_lease_seconds: 90 });
    if (error) throw new HttpError(500, "DATABASE_ERROR", "claim failed", true);
    const jobs = (data ?? []) as Job[];
    if (!jobs.length) break;
    await Promise.all(jobs.map(async (job) => {
      counts.processed++;
      try {
        const outcome = await processJob(job, deadline);
        if (outcome === "ready") counts.ready++;
      } catch (e) {
        const je = e instanceof JobError ? e : new JobError("INTERNAL", true);
        if (je.code === "STALE_FENCE") {
          counts.stale++;
          return;
        }
        try {
          const state = await rpc("worker_fail", { p_job_id: job.job_id, p_fence: job.fence, p_error_code: je.code, p_retryable: je.retryable });
          if (state === "retry_wait") counts.retried++;
          else counts.failed++;
        } catch {
          counts.stale++;
        }
      }
    }));
  }
  return counts;
}
