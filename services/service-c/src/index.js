import express from "express";
import Redis from "ioredis";
import client from "prom-client";

const app = express();

const redisHost = process.env.REDIS_HOST || "redis";
const redisPort = process.env.REDIS_PORT || 6379;
const redis = new Redis({ host: redisHost, port: redisPort });

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const totalJobsSubmitted = new client.Gauge({
  name: "total_jobs_submitted",
  help: "Total jobs ever submitted (aggregated from redis)",
});
const totalJobsCompleted = new client.Gauge({
  name: "total_jobs_completed",
  help: "Total jobs completed (aggregated from redis)",
});
const queueLength = new client.Gauge({
  name: "queue_length",
  help: "Current length of jobs_queue in Redis",
});

register.registerMetric(totalJobsSubmitted);
register.registerMetric(totalJobsCompleted);
register.registerMetric(queueLength);

async function computeStats() {
  const queued = await redis.llen("jobs_queue");
  const all = await redis.hgetall("jobs_status");
  let submitted = 0;
  let completed = 0;

  for (const [, status] of Object.entries(all)) {
    submitted++;
    if (status === "completed") completed++;
  }

  queueLength.set(queued);
  totalJobsSubmitted.set(submitted);
  totalJobsCompleted.set(completed);

  return {
    totalSubmitted: submitted,
    totalCompleted: completed,
    queueLength: queued,
  };
}

// /stats endpoint
app.get("/stats", async (req, res) => {
  const stats = await computeStats();
  res.json(stats);
});

// /metrics endpoint
app.get("/metrics", async (req, res) => {
  const stats = await computeStats();
  // stats are already pushed to gauges
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Service C stats on ${port}`);
});
