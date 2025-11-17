const express = require('express');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const redis = new Redis({ host: process.env.REDIS_HOST || "redis" });

app.post('/submit', async (req, res) => {
  const id = uuidv4();
  await redis.lpush("jobs:queue", JSON.stringify({ id }));
  await redis.incr("stats:total_jobs_submitted");
  res.json({ jobId: id });
});

app.get('/status/:id', async (req, res) => {
  const result = await redis.get(`jobs:result:${req.params.id}`);
  res.json({ id: req.params.id, result });
});

app.listen(3000, () => console.log("Service A running on 3000"));
