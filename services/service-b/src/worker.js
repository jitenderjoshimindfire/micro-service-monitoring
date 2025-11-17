const Redis = require('ioredis');
const express = require('express');
const client = require('prom-client');

const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });

const register = new client.Registry();
const jobsTotal = new client.Counter({ name: "jobs_processed_total", help: "jobs processed" });
const jobErrors = new client.Counter({ name: "job_errors_total", help: "job errors" });
const jobDuration = new client.Histogram({
  name: "job_processing_time_seconds",
  help: "processing time",
  buckets: [0.1, 0.5, 1, 2, 5]
});

register.registerMetric(jobsTotal);
register.registerMetric(jobErrors);
register.registerMetric(jobDuration);

const app = express();
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
app.listen(9100, () => console.log("Metrics exposed on 9100"));

async function heavyTask() {
  const n = 50000;
  const arr = Array.from({ length: n }, () => Math.random());
  arr.sort();
}

async function processJob(job) {
  const end = jobDuration.startTimer();
  try {
    await heavyTask();
    await redis.set(`jobs:result:${job.id}`, "done");
    await redis.incr("stats:total_jobs_completed");
    jobsTotal.inc();
  } catch (err) {
    jobErrors.inc();
  } finally {
    end();
  }
}

async function loop() {
  while (true) {
    const item = await redis.brpop("jobs:queue", 0);
    const job = JSON.parse(item[1]);
    await processJob(job);
  }
}

loop();
