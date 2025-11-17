const Redis = require("ioredis");
const express = require("express");
const client = require("prom-client");

const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });

const register = new client.Registry();
const jobsTotal = new client.Counter({
  name: "jobs_processed_total",
  help: "jobs processed",
});
const jobErrors = new client.Counter({
  name: "job_errors_total",
  help: "job errors",
});
const jobDuration = new client.Histogram({
  name: "job_processing_time_seconds",
  help: "job time",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

register.registerMetric(jobsTotal);
register.registerMetric(jobErrors);
register.registerMetric(jobDuration);
client.collectDefaultMetrics({ register });

const app = express();
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
app.listen(process.env.METRICS_PORT || 9100);

// Worker loop
async function processJob(job) {
  const end = jobDuration.startTimer();
  try {
    // Example CPU-intensive: compute primes or sort a large array
    const n = 100000;
    // simple CPU-heavy simulation
    const arr = Array.from({ length: n }, (_, i) =>
      Math.floor(Math.random() * n)
    );
    arr.sort((a, b) => a - b);
    // store result (or small summary)
    await redis.set(
      `jobs:result:${job.id}`,
      JSON.stringify({ summary: "sorted", len: arr.length })
    );
    jobsTotal.inc();
    await redis.incr("stats:total_jobs_completed");
    end();
  } catch (err) {
    jobErrors.inc();
    console.error("job error", err);
    end();
  }
}

async function workerLoop() {
  while (true) {
    // BRPOP blocks until an item is available (with timeout)
    const item = await redis.brpop("jobs:queue", 0); // [queue, payload]
    if (!item) continue;
    const payload = JSON.parse(item[1]);
    await processJob(payload);
  }
}
// start
workerLoop().catch(console.error);
