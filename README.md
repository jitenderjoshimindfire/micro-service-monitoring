# Kubernetes Microservices Monitoring Demo

Microservices‑based Node.js system running on Kubernetes with Redis, HPA, Prometheus, and Grafana.  
The system:

- Accepts job submissions via an API gateway (Service A).
- Processes CPU‑intensive jobs via a Redis queue and scalable workers (Service B).
- Aggregates stats and exposes queue metrics (Service C).
- Is monitored with Prometheus (kube‑prometheus‑stack) and Grafana dashboards.
- Scales Service B automatically with Horizontal Pod Autoscaler (HPA).


## 1. Architecture

### Services

- Service A – Job Submitter / API Gateway
  - `POST /submit` – enqueue job into Redis and return `jobId`.
  - `GET /status/:id` – returns job status and result.
  - Publishes `total_jobs_submitted` metric.

- Service B – Worker
  - Consumes jobs from `jobs_queue` in Redis.
  - CPU‑intensive tasks:
    - Calculate primes up to 100,000.
    - Or bcrypt hashing.
    - Or generate + sort array of 100,000 integers.
  - Exposes `/metrics` with:
    - `jobs_processed_total`
    - `job_processing_time_seconds` (histogram)
    - `job_errors_total`

- Service C – Stats / Aggregator
  - `GET /stats` – returns:
    - total jobs submitted, total completed, current queue length.
  - `/metrics` – exposes:
    - `total_jobs_submitted`
    - `total_jobs_completed`
    - `queue_length`

- Redis
  - Backing queue and result store for jobs.

### Kubernetes

- Deployments: service‑a, service‑b, service‑c, redis.
- Services:
  - `service-a` (ClusterIP, behind Ingress).
  - `service-b` (ClusterIP).
  - `service-c` (ClusterIP).
  - `redis` (ClusterIP).
- Ingress:
  - Exposes Service A at `http://jobs.local`.
- HPA:
  - Targets `service-b` deployment.
  - Scales from 2 → 10 replicas when CPU > 70%.

### Monitoring

- Prometheus & Grafana: installed via `kube-prometheus-stack` Helm chart.
- ServiceMonitor: Prometheus scrapes `/metrics` from Service B and C.
- Dashboards: Grafana shows:
  - CPU / memory for Service B pods.
  - Custom metrics for job throughput, latency, queue length, and errors.



## 2. Prerequisites

- Kubernetes cluster (tested with Minikube).
- Docker CLI.
- Helm v3.
- `kubectl`.
- ApacheBench (`ab`) for load testing.



## 3. Project Layout

```text
k8s-microservices-monitoring/
  services/
    service-a/
        Dockerfile
        package.json
        index.js
    service-b/
        Dockerfile
        package.json
        worker.js
    service-c/
        Dockerfile
        package.json
        index.js
  k8s/
    namespace.yaml          
    redis.yaml
    service-a.yaml
    service-b.yaml
    service-c.yaml
    ingress.yaml
    hpa-service-b.yaml
    service-monitors.yaml
  README.md
```



## 4. Local Docker Images (Minikube)

Use Minikube’s Docker daemon so the cluster can pull images directly.

```bash
# Point Docker CLI at Minikube
minikube start --cpus=4 --memory=8192
minikube addons enable metrics-server     # required for HPA [web:135][web:140]
eval $(minikube docker-env)

# Build images
cd services/service-a
docker build -t service-a:latest .
cd services/service-b
docker build -t service-b:latest .
cd services/service-c
docker build -t service-c:latest .
```

In the Deployment YAMLs (`service-a.yaml`, `service-b.yaml`, `service-c.yaml`), images are referenced as:

```yaml
image: service-a:latest
imagePullPolicy: IfNotPresent
```

(Same pattern for `service-b` and `service-c`.)



## 5. Deploy Application Stack

All manifests below assume the default namespace. If you use a custom namespace, add `-n <ns>` in commands and set `metadata.namespace` in YAMLs.

### 5.1 Redis

```bash
kubectl apply -f k8s/redis.yaml
```

Check:

```bash
kubectl get pods
kubectl get svc redis
```

### 5.2 Services A, B, C

```bash
kubectl apply -f k8s/service-a.yaml
kubectl apply -f k8s/service-b.yaml
kubectl apply -f k8s/service-c.yaml
```

Verify pods and services:

```bash
kubectl get pods
kubectl get svc
```

You should see pods `service-a-...`, `service-b-...`, `service-c-...` and their services.

### 5.3 Ingress for Service A

Create Ingress and map host `jobs.local`:

```bash
kubectl apply -f k8s/ingress.yaml
minikube addons enable ingress
```

Get Minikube IP and update `/etc/hosts`:

```bash
minikube ip
# Add line in /etc/hosts:
# <minikube-ip>  jobs.local
```

Now Service A is reachable at:

```bash
curl -X POST http://jobs.local/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"primes"}'
```



## 6. Horizontal Pod Autoscaler (Service B)

Apply HPA:

```bash
kubectl apply -f k8s/hpa-service-b.yaml
kubectl get hpa
```

HPA spec:

- `minReplicas: 2`
- `maxReplicas: 10`
- `targetCPUUtilization: 70%` for Service B deployment.

During load test, watch scaling:

```bash
kubectl get hpa -w
kubectl get pods -l app=service-b -w
```



## 7. Install Prometheus & Grafana (kube‑prometheus‑stack)

Install the Helm chart into the default namespace with release name `prometheus`.

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack -n default
```

Check components:

```bash
kubectl get pods -n default | grep prometheus
kubectl get svc -n default | grep grafana
```

Port‑forward Grafana:

```bash
kubectl port-forward -n default svc/prometheus-kube-prometheus-stack-grafana 3000:80
```

Grafana UI is now at `http://localhost:3000`.

### Login credentials

- User: `admin`
- Password: from secret:

```bash
kubectl get secret -n default prometheus-kube-prometheus-stack-grafana \
  -o jsonpath="{.data.admin-password}" | base64 --decode; echo
```

(Usually it is `prom-operator` by default.)



## 8. Configure Prometheus Scraping for Service B & C

kube‑prometheus‑stack uses `ServiceMonitor` CRDs to discover scrape targets.

### 8.1 Ensure Service ports are named

`service-b.yaml` and `service-c.yaml` should expose named port `http`:

```yaml
ports:
  - name: http
    port: 3000
    targetPort: 3000
```

Apply any changes:

```bash
kubectl apply -f k8s/service-b.yaml
kubectl apply -f k8s/service-c.yaml
```

### 8.2 Apply ServiceMonitors

`k8s/service-monitors.yaml`:

```bash
kubectl apply -f k8s/service-monitors.yaml
```

This file defines:

- `ServiceMonitor/service-b-monitor`
- `ServiceMonitor/service-c-monitor`

in namespace `default` with label `release: prometheus`, telling the operator to scrape `/metrics` from `service-b` and `service-c`.

Check:

```bash
kubectl get servicemonitor -n default
```

After 1–2 minutes, in Grafana (data source `Prometheus`) you should see custom metrics like `jobs_processed_total`, `queue_length`, etc. in autocompletion.



## 9. Create Grafana Dashboards

### 9.1 CPU and Memory (Service B)

1. Open `http://localhost:3000` → Dashboards → New → New dashboard → Add visualization.
2. Data source: `Prometheus`.
3. CPU usage per worker pod:

   ```promql
   sum by (pod) (
     rate(container_cpu_usage_seconds_total{
       namespace="default",
       pod=~"service-b-.*",
       container!="POD"
     }[5m])
   )
   ```

4. Memory usage per worker pod:

   ```promql
   sum by (pod) (
     container_memory_working_set_bytes{
       namespace="default",
       pod=~"service-b-.*",
       container!="POD"
     }
   )
   ```

Save as dashboard `K8s Worker Metrics`.

### 9.2 Custom Job Metrics (Service B & C)

Add panels to the same dashboard:

- Jobs processed per second (Service B)

  ```promql
  sum(rate(jobs_processed_total[1m]))
  ```

- Job errors per second (Service B)

  ```promql
  sum(rate(job_errors_total[5m]))
  ```

- Average job processing time (seconds)

  ```promql
  sum(rate(job_processing_time_seconds_sum[5m]))
    /
  sum(rate(job_processing_time_seconds_count[5m]))
  ```

- Queue length (Service C)

  ```promql
  queue_length
  ```

- Total jobs submitted vs completed (Service C)

  ```promql
  total_jobs_submitted
  total_jobs_completed
  ```

These panels visualize throughput, latency, queue backlog, and errors.

You can later export the dashboard JSON from Dashboard settings → JSON model → Export for submission.

*

## 10. Functional Testing

### 10.1 Quick sanity checks

Port‑forward Service A temporarily (if you don’t want to use Ingress):

```bash
kubectl port-forward svc/service-a 8080:3000
```

Submit a job:

```bash
curl -X POST http://localhost:8080/submit \
  -H "Content-Type: application/json" \
  -d '{"type":"primes"}'
```

Response:

```json
{
  "id": "<job-id>",
  "status": "queued"
}
```

Check status:

```bash
curl http://localhost:8080/status/<job-id>
```

You should see `status: "completed"` and a `result` payload after a short delay.

### 10.2 Stats endpoint

Port‑forward Service C:

```bash
kubectl port-forward svc/service-c 8081:3000
curl http://localhost:8081/stats
```

Expected JSON:

```json
{
  "totalSubmitted": <number>,
  "totalCompleted": <number>,
  "queueLength": <number>
}
```

*

## 11. Stress Testing & Observing Autoscaling

Use ApacheBench against the Ingress host.

1. Prepare request body:

   ```bash
   echo '{"type":"primes"}' > post.json
   ```

2. Run load test:

   ```bash
   ab -n 5000 -c 200 -p post.json -T application/json http://jobs.local/submit
   ```

3. Watch autoscaling and queue behavior:

   ```bash
   kubectl get hpa -w
   kubectl get pods -l app=service-b -w
   ```

4. In Grafana, observe:
   - CPU / memory for `service-b` pods increasing.
   - `jobs_processed_total` increasing.
   - `job_processing_time_seconds` latency distribution.
   - `queue_length` growing then draining as HPA adds more worker pods.

Take screenshots of:

- HPA scaling from 2 → more replicas.
- Grafana dashboards during load (high CPU, large queue).
- Queue draining back to zero after load.

*

## 12. Cleanup

To tear down everything:

```bash
helm uninstall prometheus -n default
kubectl delete -f k8s/service-monitors.yaml
kubectl delete -f k8s/hpa-service-b.yaml
kubectl delete -f k8s/ingress.yaml
kubectl delete -f k8s/service-a.yaml
kubectl delete -f k8s/service-b.yaml
kubectl delete -f k8s/service-c.yaml
kubectl delete -f k8s/redis.yaml
minikube delete 
```

*

## 13. Learning Outcomes

By following this README you cover:

- Building and containerizing Node.js microservices.
- Using Redis as a distributed job queue.
- Deploying microservices on Kubernetes with Ingress and HPA.
- Instrumenting Node.js apps with `prom-client` for Prometheus.
- Setting up kube‑prometheus‑stack via Helm for cluster and app monitoring.
- Creating Grafana dashboards for both k8s resource metrics and custom business metrics.
- Running stress tests with ApacheBench and interpreting scaling behavior.
