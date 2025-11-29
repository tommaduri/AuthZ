# Phase 5 Dashboard

Real-time visualization and demonstration platform for the Phase 5 quantum-resistant DAG platform.

## Features

### 🕸️ DAG Visualization
- Real-time force-directed graph using D3.js
- Interactive vertex exploration
- WebSocket-based live updates
- Parent-child relationship visualization

### 🔐 Crypto Operations
- Quantum-resistant encryption/decryption demos
- Support for NIST post-quantum algorithms
- Base64 encoding/decoding
- Copy-to-clipboard functionality
- Example use cases for quick testing

### 🔑 Vault Manager
- Secure secret storage
- Quantum-safe encryption
- CRUD operations for secrets
- Audit trail with timestamps

### 📊 Performance Metrics
- Real-time TPS (Transactions Per Second) charts
- Latency distribution (P50, P95, P99)
- System resource monitoring
- DAG statistics dashboard

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Visualization**: D3.js
- **Data Fetching**: SWR + Axios

## Getting Started

### Prerequisites
- Node.js 20+
- Running Phase 5 API (http://localhost:8080)

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

### Docker Deployment

```bash
# Build Docker image
docker build -t phase5-dashboard .

# Run container
docker run -p 3000:3000 phase5-dashboard
```

### Docker Compose (with Phase 5 API)

```yaml
version: '3.8'
services:
  api:
    image: phase5-api:latest
    ports:
      - "8080:8080"

  dashboard:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - api
    environment:
      - NEXT_PUBLIC_API_URL=http://api:8080
```

## Project Structure

```
dashboard/
├── app/
│   ├── page.tsx           # Home page with overview
│   ├── dag/page.tsx       # DAG visualization
│   ├── crypto/page.tsx    # Crypto operations
│   ├── vault/page.tsx     # Secret manager
│   ├── metrics/page.tsx   # Performance dashboard
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles
├── components/
│   ├── Navigation.tsx     # Top navigation bar
│   ├── MetricsCard.tsx    # Metric display card
│   ├── LiveMetrics.tsx    # Real-time metrics
│   ├── DAGVisualization.tsx  # D3 force graph
│   └── VertexList.tsx     # Vertex sidebar list
├── lib/
│   └── api.ts             # API client utilities
├── public/                # Static assets
├── Dockerfile             # Production container
└── package.json           # Dependencies
```

## API Integration

The dashboard connects to the Phase 5 REST API at `http://localhost:8080`:

### Endpoints Used

- `GET /health` - API health check
- `GET /api/v1/dag/info` - DAG statistics
- `GET /api/v1/dag/vertices` - List all vertices
- `WS /ws/dag` - WebSocket for real-time vertex updates
- `POST /api/v1/crypto/encrypt` - Encrypt data
- `POST /api/v1/crypto/decrypt` - Decrypt data
- `GET /api/v1/vault/secrets` - List secrets
- `POST /api/v1/vault/store` - Store secret
- `GET /api/v1/vault/retrieve/:key` - Retrieve secret
- `DELETE /api/v1/vault/delete/:key` - Delete secret

## Features Breakdown

### Home Page
- API status indicator
- Live system health metrics
- Quick access cards to all features
- Quick start guide
- Performance overview

### DAG Visualization
- Interactive force-directed graph
- Real-time vertex additions via WebSocket
- Click to view vertex details
- Color-coded vertex types:
  - Blue: Genesis vertices
  - Green: Transaction vertices
  - Purple: Confirmed vertices
- Edge visualization showing parent relationships
- Vertex statistics sidebar

### Crypto Operations
- Plaintext input field
- One-click encryption with quantum-resistant algorithms
- Ciphertext display (Base64 encoded)
- Decryption with validation
- Copy-to-clipboard buttons
- Example use cases:
  - Simple messages
  - JSON data
  - API keys
  - Long text blocks
- Algorithm information display

### Vault Manager
- Store secrets with custom keys
- Retrieve secrets by key
- List all stored secrets with timestamps
- Delete secrets
- Security features highlighted:
  - Quantum-safe encryption
  - Zero-knowledge architecture
  - Audit trail

### Performance Metrics
- Real-time TPS line chart
- Latency distribution chart (P50, P95, P99)
- System resource usage bars:
  - CPU usage
  - Memory usage
  - Disk I/O
  - Network bandwidth
- DAG statistics:
  - Total vertices
  - Confirmed vertices
  - Pending vertices
  - Average confirmation time

## Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

## Development

```bash
# Install dependencies
npm install

# Run dev server with hot reload
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Build for production
npm run build
```

## Demo Video Script (5 minutes)

1. **Introduction (30s)**
   - Show landing page
   - Highlight API status and live metrics

2. **DAG Visualization (90s)**
   - Navigate to /dag
   - Show real-time vertex creation
   - Interact with graph (drag, click)
   - View vertex details

3. **Crypto Operations (90s)**
   - Navigate to /crypto
   - Enter plaintext message
   - Click encrypt, show ciphertext
   - Decrypt and verify match
   - Try example use cases

4. **Vault Manager (60s)**
   - Navigate to /vault
   - Store a secret
   - Retrieve the secret
   - Show secrets list

5. **Performance Metrics (60s)**
   - Navigate to /metrics
   - Show TPS chart updating
   - Explain latency distribution
   - Highlight system resources

## Screenshots

### Home Page
![Home](docs/screenshots/home.png)

### DAG Visualization
![DAG](docs/screenshots/dag.png)

### Crypto Operations
![Crypto](docs/screenshots/crypto.png)

### Performance Metrics
![Metrics](docs/screenshots/metrics.png)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Performance Optimizations

- React Server Components for initial page load
- Client-side data fetching with SWR
- WebSocket for real-time updates
- D3.js rendering optimization
- Tailwind CSS for minimal bundle size

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-repo/phase5/issues
- Email: support@phase5.io

## Acknowledgments

- Next.js team for the excellent framework
- D3.js for powerful visualization
- Recharts for beautiful charts
- Tailwind CSS for rapid styling
