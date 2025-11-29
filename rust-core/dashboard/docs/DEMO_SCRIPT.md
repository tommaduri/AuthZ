# Phase 5 Dashboard - Demo Video Script

## Total Duration: 5 minutes

---

## Introduction (30 seconds)

**[Screen: Landing Page]**

"Welcome to Phase 5, a quantum-resistant distributed ledger platform built with Rust and powered by post-quantum cryptography."

**[Highlight API status indicator]**

"The dashboard provides real-time visualization and monitoring of our DAG-based architecture. Notice the API status is live, and we can see system health metrics updating in real-time."

**[Point to feature cards]**

"Today, I'll walk you through four key features: DAG Visualization, Crypto Operations, Vault Manager, and Performance Metrics."

---

## DAG Visualization (90 seconds)

**[Navigate to /dag]**

"First, let's look at the DAG visualization. This is a real-time, force-directed graph showing the structure of our distributed ledger."

**[Point to the graph]**

"Each node represents a vertex in the DAG. Blue nodes are genesis vertices, green are transactions, and purple indicates confirmed vertices."

**[Show WebSocket connection status]**

"Notice the 'Live' indicator - we're connected via WebSocket, so new vertices appear instantly."

**[Create a new transaction in terminal]**

```bash
curl -X POST http://localhost:8080/api/v1/dag/vertex \
  -H "Content-Type: application/json" \
  -d '{"data": "Demo transaction"}'
```

**[Watch vertex appear in graph]**

"There! A new vertex just appeared and the graph automatically reorganized itself. Let me click on it..."

**[Click vertex, show details panel]**

"The sidebar shows complete vertex details: ID, timestamp, parent references, data size, and the quantum-resistant signature."

**[Drag a vertex to demonstrate interactivity]**

"The graph is fully interactive - you can drag vertices, zoom, and explore the entire structure."

**[Point to statistics at bottom]**

"Below, we see aggregate statistics: total vertices, confirmed vs pending, and average parent count."

---

## Crypto Operations (90 seconds)

**[Navigate to /crypto]**

"Next, let's demonstrate our quantum-resistant cryptography. This page lets you encrypt and decrypt data using NIST-approved post-quantum algorithms."

**[Point to algorithm display]**

"We're using Kyber-768 for key encapsulation and Dilithium-3 for digital signatures - both resistant to attacks from quantum computers."

**[Type in plaintext field]**

"Let me enter a simple message: 'Hello, quantum-safe world!'"

**[Click Encrypt button]**

"When I click encrypt..."

**[Show ciphertext appearing with animation]**

"...we get back the ciphertext in Base64 format. Notice the encryption animation and the copy button for easy clipboard access."

**[Click Decrypt button]**

"Now, let's decrypt it..."

**[Show decrypted message]**

"Perfect! The message decrypts correctly, and we get a green checkmark confirming it matches the original plaintext."

**[Click example use cases]**

"The dashboard includes several example use cases - let me try encrypting some JSON data..."

**[Click JSON example, encrypt, decrypt]**

"Whether it's simple text, structured data, API keys, or large payloads, the quantum-resistant encryption handles it all seamlessly."

---

## Vault Manager (60 seconds)

**[Navigate to /vault]**

"Moving to the Vault Manager - this is our secure secret storage system with quantum-safe encryption."

**[Type in Store Secret section]**

"Let me store a database password. I'll use 'db_password' as the key..."

**[Type secret value]**

"...and here's the actual secret value."

**[Click Store Secret]**

"When I click Store Secret, it's encrypted with post-quantum algorithms before being saved."

**[Show success message and secrets list]**

"There we go! The secret appears in our list with creation and update timestamps."

**[Retrieve the secret]**

"Now let me retrieve it by entering the key and clicking Retrieve..."

**[Show retrieved value]**

"Perfect! The value is decrypted and displayed. Notice the copy button for secure transfer."

**[Point to security features at bottom]**

"Our vault implements three key security principles: quantum-safe encryption, zero-knowledge architecture where the server never sees unencrypted values, and complete audit trails for compliance."

---

## Performance Metrics (60 seconds)

**[Navigate to /metrics]**

"Finally, let's look at the Performance Metrics dashboard."

**[Point to quick stats cards]**

"At the top, we see real-time statistics: average and maximum transactions per second, average and P99 latency, and total transactions over the last hour."

**[Scroll to TPS chart]**

"This line chart shows transactions per second over the last 30 seconds. You can see the throughput varying as the system processes requests."

**[Point to latency chart]**

"Below is the latency distribution showing P50, P95, and P99 percentiles. This helps us identify performance bottlenecks and ensure consistent response times."

**[Show system resources]**

"On the left, we monitor system resources: CPU, memory, disk I/O, and network bandwidth - all updating in real-time."

**[Point to DAG statistics]**

"And here we see DAG-specific metrics: total vertices, confirmation counts, and average confirmation time of just 2.3 seconds."

---

## Closing (30 seconds)

**[Navigate back to home page]**

"In summary, Phase 5 combines quantum-resistant cryptography with a highly scalable DAG architecture. This dashboard makes it easy to visualize, test, and monitor the entire system in real-time."

**[Point to navigation]**

"All features are accessible through the top navigation, and the platform is fully open-source and production-ready."

**[Fade to logo]**

"Thank you for watching. Visit our GitHub repository for documentation, API specs, and deployment guides. Build the future with quantum-safe technology today."

---

## Post-Production Notes

### Camera Angles
- Use 1920x1080 resolution
- Record at 60fps for smooth animations
- Use cursor highlighting for clicks

### Audio
- Clear narration with minimal background noise
- Add subtle background music (corporate/tech)
- Volume leveling throughout

### Editing
- Add text overlays for key features
- Highlight cursor position for clicks
- Zoom in on important details
- Add transition effects between sections
- Include GitHub URL and contact info at end

### Graphics
- Phase 5 logo at start and end
- Feature name text overlays during each section
- Animated callouts for key concepts:
  - "Quantum-Resistant"
  - "Real-Time"
  - "Post-Quantum Cryptography"
  - "DAG Architecture"

### Export Settings
- Format: MP4 (H.264)
- Resolution: 1920x1080
- Bitrate: 10 Mbps
- Frame rate: 60fps
- Audio: AAC, 192 kbps
