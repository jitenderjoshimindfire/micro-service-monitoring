import express from "express";
import Redis from "ioredis";
import bcrypt from "bcrypt";
import client from "prom-client";

const app = express();

const redisHost = process.env.REDIS_HOST || "redis";
const redisPort = process.env.REDIS_PORT || 6379;
const redis = new Redis({ host: redisHost, port: redisPort });

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const jobsProcessed = new client.Counter({
  name: "jobs_processed_total",
  help: "Total number of jobs processed by worker",
});
const jobErrors = new client.Counter({
  name: "job_errors_total",
  help: "Total number of job processing errors",
});
const jobProcessingTime = new client.Histogram({
  name: "job_processing_time_seconds",
  help: "Job processing time in seconds",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

register.registerMetric(jobsProcessed);
register.registerMetric(jobErrors);
register.registerMetric(jobProcessingTime);

// CPU‑intensive helpers
function calcPrimes(limit = 100000) {
  const primes = [];
  for (let i = 2; i <= limit; i++) {
    let isPrime = true;
    const sqrt = Math.sqrt(i);
    for (let j = 2; j <= sqrt; j++) {
      if (i % j === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) primes.push(i);
  }
  return primes.length;
}

async function doBcrypt() {
  const saltRounds = 10;
  return bcrypt.hash("some_random_string", saltRounds);
}

function sortArray(n = 100000) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push(Math.floor(Math.random() * n));
  }
  arr.sort((a, b) => a - b);
  return arr[0];
}

async function processJob(job) {
  const start = Date.now();
  let result;
  try {
    if (job.type === "bcrypt") {
      result = await doBcrypt();
    } else if (job.type === "sort") {
      result = sortArray();
    } else {
      result = calcPrimes();
    }
    const duration = (Date.now() - start) / 1000;
    jobProcessingTime.observe(duration);
    jobsProcessed.inc();

    await redis.hset("jobs_status", job.id, "completed");
    await redis.hset(
      "jobs_result",
      job.id,
      JSON.stringify({ type: job.type, result, duration })
    );
  } catch (err) {
    jobErrors.inc();
    await redis.hset("jobs_status", job.id, "failed");
  }
}

// Simple polling loop
async function workerLoop() {
  while (true) {
    try {
      const item = await redis.brpop("jobs_queue", 5); // block 5s
      if (item) {
        const [, payload] = item;
        const job = JSON.parse(payload);
        await processJob(job);
      }
    } catch (err) {
      jobErrors.inc();
    }
  }
}
workerLoop();

// /metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Service B worker metrics on ${port}`);
});
