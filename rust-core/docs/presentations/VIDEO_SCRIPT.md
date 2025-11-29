# CretoAI - 5-Minute Demo Video Script

**Video Walkthrough for Sales & Marketing**

---

## Production Details

**Duration**: 5 minutes
**Format**: Screen recording + voiceover
**Resolution**: 1080p (1920x1080)
**Frame Rate**: 30 fps
**Tools**: OBS Studio, Final Cut Pro, or Camtasia

---

## Pre-Recording Setup

### Environment Checklist
- [ ] Docker running (4GB+ RAM allocated)
- [ ] CretoAI demo environment started (`./scripts/demo.sh`)
- [ ] Swagger UI accessible (http://localhost:8080/swagger-ui)
- [ ] Browser zoom at 100% (no scaling)
- [ ] Close unnecessary browser tabs
- [ ] Disable notifications (macOS/Windows)

### Recording Settings
- **Screen Area**: Full browser window (Swagger UI)
- **Audio**: High-quality microphone (48kHz, 16-bit)
- **Background**: Solid color or company branding
- **Cursor**: Highlighted (yellow ring, size 30px)

---

## Video Script

### [00:00-00:30] Introduction (30 seconds)

**Visual**: Title slide with CretoAI logo

**Voiceover**:
> "Welcome to CretoAI—the only quantum-resistant security platform designed for enterprise AI systems. In the next five minutes, I'll show you how CretoAI protects autonomous AI agents from quantum computer attacks while delivering industry-leading performance: 56,000 transactions per second with 177 millisecond finality."

**On-Screen Text**:
```
CretoAI
Quantum-Resistant Security for Agentic AI

✅ 56,271 TPS
✅ 177ms Finality
✅ NIST-Approved Post-Quantum Crypto
```

---

### [00:30-01:30] Quantum Threat Overview (1 minute)

**Visual**: Threat timeline animation (2024-2035)

**Voiceover**:
> "Why quantum-resistant security now? Because quantum computers are closer than you think. Google's Willow chip demonstrated quantum supremacy in December 2024. The NSA's CNSA 2.0 mandate requires all federal systems to migrate to post-quantum cryptography by 2035. And adversaries are already harvesting encrypted data today to decrypt with future quantum computers—what's called 'harvest now, decrypt later.'"

**Animation**:
- 2024: Google Willow (quantum supremacy)
- 2025: NERC CIP-015-1 effective (critical infrastructure)
- 2030: First RSA-2048 breaks expected
- 2035: NSA CNSA 2.0 full compliance required

**Transition**: Fade to Swagger UI

**Voiceover**:
> "Let's see how CretoAI solves this."

---

### [01:30-02:30] Demo 1: Quantum-Resistant Key Generation (1 minute)

**Visual**: Swagger UI - `POST /api/v1/crypto/keygen`

**Voiceover**:
> "First, we'll generate a quantum-resistant keypair using ML-DSA, which is NIST's approved post-quantum signature algorithm."

**Actions**:
1. Click on `POST /api/v1/crypto/keygen`
2. Click "Try it out"
3. Enter request body:
   ```json
   {
     "algorithm": "dilithium",
     "security_level": 3
   }
   ```
4. Click "Execute"

**Voiceover** (while executing):
> "Unlike RSA, which will be broken by quantum computers in the next 10 years, ML-DSA provides security equivalent to AES-192—which is quantum-safe until at least 2050."

**Visual**: Highlight response (zoom in):
```json
{
  "public_key": "0x7a3f9e2b...",
  "key_id": "ml-dsa-87-20251127-abc123",
  "algorithm": "ML-DSA-87",
  "security_level": "NIST Level 3 (AES-192 equivalent)"
}
```

**Voiceover**:
> "The public key can now be used for agent authentication, and the private key remains secure—even against future quantum attacks."

---

### [02:30-03:30] Demo 2: Digital Signature & Verification (1 minute)

**Visual**: Swagger UI - `POST /api/v1/crypto/sign`

**Voiceover**:
> "Now let's sign a transaction using our quantum-resistant keypair. This could be an AI agent authorizing a financial transaction, accessing patient data, or controlling critical infrastructure."

**Actions**:
1. Scroll to `POST /api/v1/crypto/sign`
2. Click "Try it out"
3. Enter request body:
   ```json
   {
     "message": "VHJhbnNhY3Rpb246IFRyYW5zZmVyICQxMDBLIGZyb20gQUktQWdlbnQtMDAxIHRvIEFJLUFnZW50LTAwMg==",
     "algorithm": "dilithium87",
     "key_id": "ml-dsa-87-20251127-abc123"
   }
   ```
4. Click "Execute"

**Voiceover** (while executing):
> "This message is a base64-encoded financial transaction: 'Transfer $100K from AI-Agent-001 to AI-Agent-002.' The signature proves this transaction was authorized by the agent—and cannot be forged, even with a quantum computer."

**Visual**: Highlight response:
```json
{
  "signature": "0x4f8a2d1c...",
  "algorithm": "ML-DSA-87",
  "verified": true
}
```

---

### [03:30-04:30] Demo 3: Byzantine Consensus (1 minute)

**Visual**: Swagger UI - `POST /api/v1/consensus/transaction`

**Voiceover**:
> "But quantum-resistant signatures are only half the solution. What if a malicious agent tries to authorize a fraudulent transaction? That's where Byzantine consensus comes in."

**Actions**:
1. Scroll to `POST /api/v1/consensus/transaction`
2. Click "Try it out"
3. Enter request body:
   ```json
   {
     "data": "VHJhbnNhY3Rpb246IFRyYW5zZmVyICQxMDBL",
     "priority": "high",
     "signature": "0x4f8a2d1c..."
   }
   ```
4. Click "Execute"

**Voiceover** (while executing):
> "CretoAI submits this transaction to a Byzantine fault-tolerant consensus network. Even if up to 33% of nodes are malicious, the system reaches agreement on the correct transaction."

**Visual**: Response shows finality time:
```json
{
  "transaction_id": "tx-20251127-abc123",
  "status": "finalized",
  "finalized_at": "2025-11-27T10:30:00.177Z",
  "consensus_nodes": 3,
  "votes": {
    "node-1": "accept",
    "node-2": "accept",
    "node-3": "accept"
  }
}
```

**Voiceover**:
> "177 milliseconds to finality. That's 5.6 times faster than the industry standard, and completely tamper-proof."

---

### [04:30-04:50] Performance Metrics (20 seconds)

**Visual**: Benchmark results chart (from `/docs/benchmarks/charts/`)

**Voiceover**:
> "All our performance claims are validated with real benchmarks. We process 56,271 transactions per second—that's 12.5 times faster than traditional blockchain platforms. Consensus finality in 177 milliseconds—5.6 times faster than the 1-second industry standard. And we do it all with only 45 megabytes of memory for 100,000 transactions."

**On-Screen Text**:
```
✅ 56,271 TPS (validated)
✅ 177ms finality (validated)
✅ 45 MB memory (validated)
```

---

### [04:50-05:00] Call to Action (10 seconds)

**Visual**: Fade to contact slide

**Voiceover**:
> "CretoAI is production-ready today. Schedule a demo at cretoai.ai, or email sales@cretoai.ai to get started."

**On-Screen Text**:
```
Ready to protect your AI agents?

🌐 cretoai.ai
📧 sales@cretoai.ai
📅 Schedule a demo

The future is quantum-safe.
The future is CretoAI.
```

**Fade Out**

---

## Post-Production Editing

### Video Enhancements
1. **Title Cards**: Add at 0:00, 1:30, 2:30, 3:30, 4:30
2. **Zoom Effects**: Highlight key API responses (signature, consensus result)
3. **Cursor Tracking**: Yellow ring around cursor for visibility
4. **Transitions**: Smooth fades between sections (0.5s)

### Audio Enhancements
1. **Background Music**: Subtle tech music (low volume, 10-15%)
2. **Noise Reduction**: Remove background hiss
3. **Normalization**: -3dB peak, consistent volume
4. **Sound Effects**: Subtle "success" chime on consensus finality

### Captions
- **Closed Captions**: Auto-generated + manual review
- **On-Screen Text**: Key metrics, URLs, email
- **Font**: Roboto, 24pt, white with black outline

---

## Distribution Checklist

### Upload Platforms
- [ ] **YouTube**: Public (unlisted for pre-launch)
- [ ] **Vimeo**: Professional account (password-protected for sales team)
- [ ] **Company Website**: Embedded on homepage (cretoai.ai)
- [ ] **Sales Portal**: Downloadable MP4 for offline demos

### Metadata
- **Title**: "CretoAI: 5-Minute Demo - Quantum-Resistant Security for AI Agents"
- **Description**:
  > "See how CretoAI protects autonomous AI systems from quantum computer attacks with NIST-approved post-quantum cryptography. Features: 56,271 TPS, 177ms finality, Byzantine fault tolerance. Schedule a demo at cretoai.ai."
- **Tags**: quantum cryptography, post-quantum, AI security, Byzantine consensus, enterprise AI, NIST FIPS 203, ML-KEM, ML-DSA
- **Thumbnail**: CretoAI logo + "5-Min Demo" + performance metrics

### Social Media Snippets
Create 30-second clips for:
- **LinkedIn**: Quantum threat overview (00:30-01:00)
- **Twitter**: Performance demo (04:30-04:50)
- **YouTube Shorts**: Key generation (01:30-02:00)

---

## Alternative Versions

### 30-Second Teaser
- [00:00-00:10] Intro
- [01:30-01:50] Key generation
- [04:30-04:50] Performance metrics
- [04:50-05:00] CTA

### 10-Minute Extended Demo
Add these sections:
- **Use Case Examples** (2 min): FinTech, Healthcare, Government
- **Architecture Walkthrough** (2 min): REST API → Consensus → DAG storage
- **Compliance Overview** (1 min): CNSA 2.0, FedRAMP, NERC CIP-015-1

### Custom Industry Demos
- **FinTech**: Focus on payment signatures (2:30-3:30)
- **Healthcare**: Focus on HIPAA audit trails (3:30-4:30)
- **Government**: Focus on CNSA 2.0 compliance (0:30-1:30)

---

## Screen Recording Instructions

### macOS (QuickTime)
```bash
# Start recording
# File → New Screen Recording → Select area → Start

# Stop recording
# Command + Control + Esc

# Export
# File → Export As → 1080p
```

### Windows (OBS Studio)
```
1. Download OBS Studio (obsproject.com)
2. Add Source → Display Capture
3. Settings → Output → Recording Quality: High Quality
4. Start Recording (hotkey: F9)
5. Stop Recording (hotkey: F10)
```

### Linux (SimpleScreenRecorder)
```bash
# Install
sudo apt install simplescreenrecorder

# Configure
# Input → Record a fixed rectangle
# Output → MP4, H.264, 1080p, 30fps

# Record
# Start recording → F9
# Stop recording → F10
```

---

## Voiceover Recording Tips

### Equipment
- **Microphone**: Blue Yeti, Audio-Technica AT2020, or similar
- **Pop Filter**: Essential for reducing plosives
- **Acoustic Treatment**: Record in quiet room (closet with clothes works)

### Recording Settings
- **Sample Rate**: 48kHz
- **Bit Depth**: 24-bit
- **Format**: WAV (lossless)
- **Gain**: Set to -18dB peak (Audacity metering)

### Delivery Tips
- **Pace**: 150 words/minute (conversational, not rushed)
- **Tone**: Professional but approachable (imagine talking to a colleague)
- **Pauses**: 1-second pause between sections (for editing)
- **Energy**: Enthusiastic but not over-the-top

### Post-Processing (Audacity)
1. **Noise Reduction**: Effect → Noise Reduction → Get Noise Profile → Apply
2. **Normalization**: Effect → Normalize → -3dB
3. **Compression**: Effect → Compressor → Threshold -18dB, Ratio 3:1
4. **EQ**: Effect → Equalization → Bass boost +3dB, Treble boost +2dB

---

## Quality Assurance Checklist

### Before Publishing
- [ ] Video resolution: 1080p (1920x1080)
- [ ] Frame rate: 30 fps (smooth playback)
- [ ] Audio: Clear, no background noise
- [ ] Captions: Accurate, spell-checked
- [ ] Timing: 5:00 ± 10 seconds
- [ ] Branding: CretoAI logo visible
- [ ] CTA: URL and email correct

### Testing
- [ ] Watch full video on YouTube (check quality)
- [ ] Test on mobile (vertical viewing)
- [ ] Check captions (auto-generated + manual)
- [ ] Verify thumbnail (eye-catching, on-brand)
- [ ] Test embed on website (cretoai.ai)

---

## Analytics & Tracking

### YouTube Analytics
Track:
- **Views**: Target 10,000+ in first month
- **Watch Time**: Target 60%+ average retention
- **CTR**: Target 5%+ click-through rate (thumbnail)
- **Traffic Sources**: YouTube search, social media, website embed

### Sales Metrics
Track:
- **Demo Requests**: Leads from video CTA
- **Sales Qualified Leads (SQL)**: Conversion rate from video
- **Revenue Attribution**: Deals closed from video leads

---

## Next Steps for Sales Team

### Using the Video
1. **Email Campaigns**: Embed in outreach emails (Vimeo link)
2. **LinkedIn Posts**: Share 30-second teaser with link to full demo
3. **Sales Calls**: Screen share during discovery calls
4. **Trade Shows**: Loop on booth displays (muted with captions)

### Follow-Up Materials
- Send benchmark report after video (`/docs/benchmarks/PERFORMANCE_RESULTS.md`)
- Offer live demo (10-minute deep dive with Swagger UI)
- Provide use case documentation (FinTech, Healthcare, Government)

---

**Video Script Version**: 1.0
**Last Updated**: November 27, 2025
**Target Audience**: Executives, Technical Decision Makers, Sales Prospects
**Distribution**: Public (YouTube, Vimeo, cretoai.ai)
