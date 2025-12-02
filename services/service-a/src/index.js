import express from "express";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import client from "prom-client";

const app = express();
app.use(express.json());

const redisHost = process.env.REDIS_HOST || "redis";
const redisPort = process.env.REDIS_PORT || 6379;
const redis = new Redis({ host: redisHost, port: redisPort });

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const totalJobsSubmitted = new client.Counter({
  name: "total_jobs_submitted",
  help: "Total number of jobs submitted via Service A",
});
register.registerMetric(totalJobsSubmitted);

// Simple submit endpoint
app.post("/submit", async (req, res) => {
  try {
    console.log("submit hit")
    const id = uuidv4();
    const jobType = req.body.type || "primes"; // type: primes | bcrypt | sort
    const payload = { id, type: jobType, createdAt: Date.now() };

    await redis.lpush("jobs_queue", JSON.stringify(payload));
    await redis.hset("jobs_status", id, "queued");
    totalJobsSubmitted.inc();

    res.json({ id, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: "failed_to_submit" });
  }
});

// Status by ID (reads redis)
app.get("/status/:id", async (req, res) => {
  const id = req.params.id;
  const status = await redis.hget("jobs_status", id);
  const result = await redis.hget("jobs_result", id);
  res.json({ id, status, result: result ? JSON.parse(result) : null });
});

// /metrics for Prometheus if you also want to scrape A
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Service A listening on ${port}`);
});
