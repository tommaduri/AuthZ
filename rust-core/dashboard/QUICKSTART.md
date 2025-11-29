# Phase 5 Dashboard - Quick Start Guide

## Prerequisites

- Node.js 20 or higher
- Running Phase 5 API at http://localhost:8080
- npm or yarn package manager

## Installation (3 steps)

### 1. Install Dependencies

```bash
cd dashboard
npm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
```

Edit `.env.local` if your API is not at localhost:8080:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

### 3. Start Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## Docker Quick Start

### Option 1: Dashboard Only

```bash
docker build -t phase5-dashboard .
docker run -p 3000:3000 phase5-dashboard
```

### Option 2: Full Stack (API + Dashboard)

```bash
cd ..
docker-compose -f docker-compose.dashboard.yml up -d
```

This starts:
- PostgreSQL at :5432
- Phase 5 API at :8080
- Dashboard at :3000

## Verify Installation

1. **Check API Connection**
   - Navigate to http://localhost:3000
   - Look for green "API Status: ONLINE" indicator

2. **Test DAG Visualization**
   - Click "DAG" in navigation
   - Create a vertex:
     ```bash
     curl -X POST http://localhost:8080/api/v1/dag/vertex \
       -H "Content-Type: application/json" \
       -d '{"data": "test"}'
     ```
   - Watch vertex appear in graph

3. **Test Crypto Operations**
   - Click "Crypto" in navigation
   - Enter text and click "Encrypt"
   - Verify ciphertext appears
   - Click "Decrypt" to verify

## Common Issues

### Port Already in Use

```bash
# Check what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### API Connection Failed

- Verify Phase 5 API is running: `curl http://localhost:8080/health`
- Check `.env.local` has correct API URL
- Check browser console for CORS errors

### npm Install Errors

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### WebSocket Not Connecting

- Check browser console for WebSocket errors
- Verify WS URL in `.env.local`
- Check firewall/proxy settings

## Development Commands

```bash
# Start dev server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
dashboard/
├── app/              # Next.js pages (App Router)
│   ├── page.tsx      # Home page
│   ├── dag/          # DAG visualization
│   ├── crypto/       # Crypto operations
│   ├── vault/        # Secret manager
│   └── metrics/      # Performance dashboard
├── components/       # React components
├── lib/             # Utilities and API client
└── public/          # Static assets
```

## Next Steps

1. **Explore Features**
   - Try all 4 main pages
   - Create vertices and watch DAG grow
   - Encrypt/decrypt different data types
   - Store and retrieve secrets

2. **Customize**
   - Modify colors in `tailwind.config.ts`
   - Add new charts to metrics page
   - Extend API client in `lib/api.ts`

3. **Deploy**
   - Build production bundle: `npm run build`
   - Deploy to Vercel, Netlify, or Docker

## Support

- Documentation: See README.md
- API Docs: http://localhost:8080/api-docs
- Issues: GitHub Issues

## Performance Tips

- Use production build for best performance
- Enable React DevTools for debugging
- Monitor WebSocket connections
- Check browser console for errors

Happy coding! 🚀
