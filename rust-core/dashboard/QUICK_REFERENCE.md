# Phase 5 Dashboard - Quick Reference Card

## 🚀 One-Command Start

```bash
cd dashboard && npm install && npm run dev
```

Then open: **http://localhost:3000**

---

## 📁 Project Structure

```
dashboard/
├── app/
│   ├── page.tsx          → Home page
│   ├── dag/page.tsx      → DAG visualization
│   ├── crypto/page.tsx   → Encrypt/decrypt
│   ├── vault/page.tsx    → Secret manager
│   └── metrics/page.tsx  → Performance charts
├── components/           → Reusable UI components
├── lib/api.ts           → API client
└── package.json         → Dependencies
```

---

## 🎯 Key Features

| Feature | URL | Purpose |
|---------|-----|---------|
| **Home** | `/` | Overview + metrics |
| **DAG** | `/dag` | Real-time graph (D3.js) |
| **Crypto** | `/crypto` | Encrypt/decrypt demo |
| **Vault** | `/vault` | Secret storage |
| **Metrics** | `/metrics` | Charts + analytics |

---

## 🔧 Essential Commands

```bash
# Development
npm run dev         # Start dev server (hot reload)
npm run build       # Build for production
npm start           # Start production server

# Docker
docker build -t phase5-dashboard .
docker run -p 3000:3000 phase5-dashboard

# Full Stack
docker-compose -f ../docker-compose.dashboard.yml up -d
```

---

## 🌐 API Endpoints Used

```
GET  /health                       → API status
GET  /api/v1/dag/vertices          → List vertices
WS   /ws/dag                       → Live updates
POST /api/v1/crypto/encrypt        → Encrypt data
POST /api/v1/crypto/decrypt        → Decrypt data
GET  /api/v1/vault/secrets         → List secrets
POST /api/v1/vault/store           → Store secret
GET  /api/v1/vault/retrieve/:key   → Get secret
```

---

## ⚙️ Environment Variables

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

---

## 🎨 Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Charts:** Recharts
- **Visualization:** D3.js
- **HTTP:** Axios + SWR
- **Container:** Docker (Alpine)

---

## 🐛 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 3000 in use | `lsof -i :3000` then `kill -9 <PID>` |
| API not connecting | Check `http://localhost:8080/health` |
| npm install fails | `rm -rf node_modules package-lock.json && npm install` |
| WebSocket errors | Verify WS URL in `.env.local` |

---

## 📊 Component Quick Reference

```tsx
// API Client
import { api } from '@/lib/api';
const data = await api.getVertices();

// WebSocket
import { createDAGWebSocket } from '@/lib/api';
const ws = createDAGWebSocket((vertex) => {
  console.log('New vertex:', vertex);
});

// Components
import Navigation from '@/components/Navigation';
import MetricsCard from '@/components/MetricsCard';
import DAGVisualization from '@/components/DAGVisualization';
```

---

## 🚢 Deployment Quick Guide

### Local Production
```bash
npm run build && npm start
```

### Docker
```bash
docker build -t phase5-dashboard .
docker run -p 3000:3000 phase5-dashboard
```

### Vercel
```bash
vercel
```

### Kubernetes
```bash
kubectl apply -f deployment.yaml
```

---

## 📝 File Locations

| File | Path |
|------|------|
| Home Page | `app/page.tsx` |
| API Client | `lib/api.ts` |
| Navigation | `components/Navigation.tsx` |
| Tailwind Config | `tailwind.config.ts` |
| Docker Compose | `../docker-compose.dashboard.yml` |
| README | `README.md` |

---

## 🔐 Security Checklist

- ✅ Quantum-resistant encryption (Kyber-768, Dilithium-3)
- ✅ HTTPS in production (configure reverse proxy)
- ✅ Environment variables for secrets
- ✅ CORS configuration in `next.config.mjs`
- ✅ Non-root Docker user
- ✅ Input validation on forms

---

## 📈 Performance Targets

- Initial load: < 1s
- Route navigation: < 100ms
- WebSocket latency: < 50ms
- Bundle size: ~160KB (gzipped)
- Docker image: ~150MB

---

## 🎥 Demo Flow (5 min)

1. **Home** (30s) - Show API status + metrics
2. **DAG** (90s) - Create vertex, watch graph update
3. **Crypto** (90s) - Encrypt message, decrypt, verify
4. **Vault** (60s) - Store secret, retrieve it
5. **Metrics** (60s) - Show charts updating

---

## 📞 Support

- **Docs:** See README.md, QUICKSTART.md, DEPLOYMENT.md
- **API Docs:** http://localhost:8080/api-docs
- **Issues:** GitHub Issues

---

## ✅ Pre-Launch Checklist

- [ ] API running at :8080
- [ ] `npm install` completed
- [ ] `.env.local` configured
- [ ] Dev server started
- [ ] Browser at localhost:3000
- [ ] Green API status indicator
- [ ] All 4 pages accessible

---

**Created by:** Frontend Developer Agent
**Date:** 2025-11-27
**Status:** ✅ Production Ready
