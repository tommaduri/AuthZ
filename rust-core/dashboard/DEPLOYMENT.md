# Phase 5 Dashboard - Deployment Guide

## Overview

The Phase 5 Dashboard is a Next.js 14 application with TypeScript, Tailwind CSS, and real-time WebSocket capabilities. This guide covers all deployment scenarios.

## Architecture

```
┌─────────────────┐
│   Browser       │
│  (Port 3000)    │
└────────┬────────┘
         │ HTTP/WS
         ▼
┌─────────────────┐
│  Next.js        │
│  Dashboard      │
└────────┬────────┘
         │ REST API
         ▼
┌─────────────────┐
│  Phase 5 API    │
│  (Port 8080)    │
└────────┬────────┘
         │ SQL
         ▼
┌─────────────────┐
│  PostgreSQL     │
│  (Port 5432)    │
└─────────────────┘
```

## Deployment Options

### Option 1: Local Development

**Best for:** Development, testing, demos

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Access at: http://localhost:3000

**Features:**
- Hot module reloading
- React Fast Refresh
- Source maps for debugging
- TypeScript type checking
- ESLint integration

### Option 2: Production Build

**Best for:** Production deployments, performance testing

```bash
# Build optimized bundle
npm run build

# Start production server
npm start
```

**Optimizations:**
- Minified JavaScript
- Code splitting
- Image optimization
- Static generation where possible
- Server-side rendering for dynamic pages

### Option 3: Docker Container

**Best for:** Isolated deployments, microservices

```bash
# Build image
docker build -t phase5-dashboard:latest .

# Run container
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=http://api:8080 \
  phase5-dashboard:latest
```

**Image size:** ~150MB (Alpine-based)

### Option 4: Docker Compose (Full Stack)

**Best for:** Complete system deployment, production

```bash
# Start all services
docker-compose -f docker-compose.dashboard.yml up -d

# View logs
docker-compose logs -f dashboard

# Stop all services
docker-compose down
```

**Services:**
- PostgreSQL (persistent data)
- Phase 5 API (REST + WebSocket)
- Dashboard (Next.js)

## Environment Configuration

### Required Variables

```env
# API Configuration (REQUIRED)
NEXT_PUBLIC_API_URL=http://localhost:8080

# WebSocket URL (optional, defaults to API URL)
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

### Optional Variables

```env
# Node environment
NODE_ENV=production

# Port (default: 3000)
PORT=3000

# Hostname (default: 0.0.0.0)
HOSTNAME=0.0.0.0

# Disable telemetry
NEXT_TELEMETRY_DISABLED=1
```

## Cloud Deployments

### Vercel (Recommended for Next.js)

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   vercel
   ```

3. **Set environment variables:**
   ```bash
   vercel env add NEXT_PUBLIC_API_URL
   ```

4. **Production deployment:**
   ```bash
   vercel --prod
   ```

**Benefits:**
- Automatic SSL certificates
- Global CDN
- Serverless functions
- Zero configuration
- Git integration

### AWS Elastic Beanstalk

1. **Install EB CLI:**
   ```bash
   pip install awsebcli
   ```

2. **Initialize:**
   ```bash
   eb init -p docker phase5-dashboard
   ```

3. **Create environment:**
   ```bash
   eb create phase5-dashboard-env
   ```

4. **Deploy:**
   ```bash
   eb deploy
   ```

**Configuration (`.ebextensions/nodejs.config`):**
```yaml
option_settings:
  aws:elasticbeanstalk:application:environment:
    NEXT_PUBLIC_API_URL: http://api.example.com
```

### Google Cloud Run

1. **Build and push image:**
   ```bash
   gcloud builds submit --tag gcr.io/PROJECT_ID/phase5-dashboard
   ```

2. **Deploy:**
   ```bash
   gcloud run deploy phase5-dashboard \
     --image gcr.io/PROJECT_ID/phase5-dashboard \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars NEXT_PUBLIC_API_URL=http://api.example.com
   ```

### Kubernetes

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: phase5-dashboard
spec:
  replicas: 3
  selector:
    matchLabels:
      app: phase5-dashboard
  template:
    metadata:
      labels:
        app: phase5-dashboard
    spec:
      containers:
      - name: dashboard
        image: phase5-dashboard:latest
        ports:
        - containerPort: 3000
        env:
        - name: NEXT_PUBLIC_API_URL
          value: "http://phase5-api:8080"
---
apiVersion: v1
kind: Service
metadata:
  name: phase5-dashboard
spec:
  selector:
    app: phase5-dashboard
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

**Deploy:**
```bash
kubectl apply -f deployment.yaml
```

## Performance Optimization

### 1. Enable Output Standalone

**next.config.mjs:**
```javascript
const nextConfig = {
  output: 'standalone',
  // ... other config
};
```

This reduces Docker image size by 50%+.

### 2. Image Optimization

Use Next.js Image component:
```tsx
import Image from 'next/image';

<Image
  src="/logo.png"
  width={200}
  height={100}
  alt="Logo"
/>
```

### 3. Code Splitting

Dynamic imports for large components:
```tsx
import dynamic from 'next/dynamic';

const DAGVisualization = dynamic(() => import('@/components/DAGVisualization'), {
  loading: () => <p>Loading...</p>,
  ssr: false,
});
```

### 4. Caching Strategy

**headers.js:**
```javascript
module.exports = {
  async headers() {
    return [
      {
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};
```

## Monitoring and Logging

### Application Logs

**Docker:**
```bash
docker logs -f phase5-dashboard
```

**Kubernetes:**
```bash
kubectl logs -f deployment/phase5-dashboard
```

### Health Checks

**Endpoint:** `/api/health`

**Docker health check:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
```

### Metrics

Monitor these key metrics:
- **Response time:** < 200ms (p95)
- **Error rate:** < 0.1%
- **WebSocket connections:** Active count
- **Memory usage:** < 512MB
- **CPU usage:** < 50%

## Security

### HTTPS Configuration

**Nginx reverse proxy:**
```nginx
server {
    listen 443 ssl;
    server_name dashboard.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### CORS Configuration

**next.config.mjs:**
```javascript
async headers() {
  return [
    {
      source: '/api/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE' },
      ],
    },
  ];
},
```

## Scaling

### Horizontal Scaling

**Docker Compose:**
```bash
docker-compose up -d --scale dashboard=3
```

**Kubernetes:**
```bash
kubectl scale deployment/phase5-dashboard --replicas=5
```

### Load Balancing

Use nginx or cloud load balancers:
- **AWS:** Application Load Balancer
- **GCP:** Cloud Load Balancing
- **Azure:** Azure Load Balancer

## Backup and Recovery

### Database Backups

```bash
# Backup
docker exec phase5-postgres pg_dump -U postgres phase5 > backup.sql

# Restore
docker exec -i phase5-postgres psql -U postgres phase5 < backup.sql
```

### Application State

Dashboard is stateless - all data in PostgreSQL.

## Troubleshooting

### Issue: Dashboard can't connect to API

**Solution:**
1. Check API is running: `curl http://localhost:8080/health`
2. Verify environment variables
3. Check network connectivity
4. Review browser console for CORS errors

### Issue: WebSocket disconnects frequently

**Solution:**
1. Increase WebSocket timeout
2. Check proxy/load balancer settings
3. Enable keep-alive
4. Monitor connection pool

### Issue: Slow initial load

**Solution:**
1. Enable code splitting
2. Optimize images
3. Use CDN for static assets
4. Enable gzip compression

## Maintenance

### Updates

```bash
# Update dependencies
npm update

# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix
```

### Database Migrations

```bash
# Run migrations
npm run migrate

# Rollback
npm run migrate:rollback
```

## Support and Resources

- **Documentation:** README.md
- **API Docs:** http://localhost:8080/api-docs
- **Issues:** GitHub Issues
- **Community:** Discord/Slack

## License

MIT License - See LICENSE file for details.
