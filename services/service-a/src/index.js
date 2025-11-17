const express = require("express");
const Redis = require("ioredis");
const { v4: uuidv4 } = require("uuid");

const port = process.env.PORT || 3000;
const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });

const app = express();
app.use(express.json());

app.post("/submit", async (req, res) => {
  const jobId = uuidv4();
  const payload = { id: jobId, type: "cpu", data: req.body || {} };
  // push to list (LPUSH) or use RPOPLPUSH based pattern
  await redis.lpush("jobs:queue", JSON.stringify(payload));
  await redis.incr("stats:total_jobs_submitted");
  res.json({ id: jobId });
});

app.get("/status/:id", async (req, res) => {
  const id = req.params.id;
  const result = await redis.get(`jobs:result:${id}`);
  res.json({ id, status: result ? "done" : "pending", result });
});

app.listen(port, () => console.log(`Service A listening ${port}`));
