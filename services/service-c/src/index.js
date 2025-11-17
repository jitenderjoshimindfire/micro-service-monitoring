const express = require("express");
const Redis = require("ioredis");
const client = require("prom-client");

const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });

const totalSubmitted = new client.Gauge({
  name: "total_jobs_submitted",
  help: "submitted",
});
const totalCompleted = new client.Gauge({
  name: "total_jobs_completed",
  help: "completed",
});
const queueLength = new client.Gauge({
  name: "queue_length",
  help: "queue length",
});

const register = new client.Registry();
register.registerMetric(totalSubmitted);
register.registerMetric(totalCompleted);
register.registerMetric(queueLength);
client.collectDefaultMetrics({ register });

const app = express();
app.get("/stats", async (req, res) => {
  const submitted = parseInt(
    (await redis.get("stats:total_jobs_submitted")) || "0",
    10
  );
  const completed = parseInt(
    (await redis.get("stats:total_jobs_completed")) || "0",
    10
  );
  const qlen = await redis.llen("jobs:queue");
  res.json({ submitted, completed, queueLength: qlen });
});

app.get("/metrics", async (req, res) => {
  totalSubmitted.set(
    parseInt((await redis.get("stats:total_jobs_submitted")) || "0", 10)
  );
  totalCompleted.set(
    parseInt((await redis.get("stats:total_jobs_completed")) || "0", 10)
  );
  queueLength.set(await redis.llen("jobs:queue"));
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(process.env.PORT || 4000, () => console.log("Service C listening"));
