const express = require('express');
const Redis = require('ioredis');
const client = require('prom-client');

const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });
const app = express();

const totalSubmitted = new client.Gauge({ name: "total_jobs_submitted", help: "submitted" });
const totalCompleted = new client.Gauge({ name: "total_jobs_completed", help: "completed" });
const queueLength = new client.Gauge({ name: "queue_length", help: "queue length" });

const register = new client.Registry();
register.registerMetric(totalSubmitted);
register.registerMetric(totalCompleted);
register.registerMetric(queueLength);

app.get('/stats', async (req, res) => {
  const s = parseInt(await redis.get("stats:total_jobs_submitted") || 0);
  const c = parseInt(await redis.get("stats:total_jobs_completed") || 0);
  const q = await redis.llen("jobs:queue");
  res.json({ submitted: s, completed: c, queue: q });
});

app.get('/metrics', async (req, res) => {
  totalSubmitted.set(parseInt(await redis.get("stats:total_jobs_submitted") || 0));
  totalCompleted.set(parseInt(await redis.get("stats:total_jobs_completed") || 0));
  queueLength.set(await redis.llen("jobs:queue"));

  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(4000, () => console.log("Service C running on 4000"));
