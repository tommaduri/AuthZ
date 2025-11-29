# CretoAI Bug Bounty Program
**Securing the Future of Autonomous Agent Consensus**

---

## Program Overview

CretoAI is committed to the security of our Phase 7 Enhanced Consensus System. We welcome security researchers and ethical hackers to help identify vulnerabilities in our system.

**Program Start Date:** January 1, 2024
**Program Type:** Private (by invitation) → Public (Q2 2024)
**Platform:** HackerOne / Bugcrowd (TBD)

---

## Scope

### In-Scope Systems

✅ **Consensus System**
- Weighted voting mechanism
- Adaptive quorum algorithm
- Multi-signature aggregation
- Fork detection system
- Byzantine fault tolerance

✅ **Reputation System**
- Reputation scoring algorithm
- Reputation decay mechanisms
- Validator reputation tracking

✅ **Compliance Monitoring**
- Real-time compliance checks
- Audit logging system
- CMMC/FedRAMP validation

✅ **API Endpoints**
- REST API (api.cretoai.io)
- gRPC endpoints
- WebSocket connections

✅ **Infrastructure**
- Kubernetes configurations
- Network policies
- Access control mechanisms
- TLS/mTLS implementations

### Out-of-Scope

❌ Social engineering attacks
❌ Physical security testing
❌ Denial of Service (DoS) attacks
❌ Third-party services and dependencies
❌ Testing on production environments without prior approval
❌ Automated vulnerability scanners without coordination

---

## Vulnerability Categories

### Critical (P1)
**Reward Range: $5,000 - $10,000**

- Remote code execution (RCE)
- SQL injection leading to data breach
- Authentication bypass allowing admin access
- Consensus manipulation allowing Byzantine attacks
- Cryptographic vulnerabilities in signature schemes
- Data breaches exposing CUI/PII

### High (P2)
**Reward Range: $2,000 - $5,000**

- Privilege escalation
- Server-Side Request Forgery (SSRF) with impact
- XML External Entity (XXE) injection
- Fork detection bypass
- Reputation system manipulation
- CMMC/FedRAMP compliance violations

### Medium (P3)
**Reward Range: $500 - $2,000**

- Cross-Site Scripting (XSS) - Stored
- Cross-Site Request Forgery (CSRF) with impact
- Information disclosure (non-sensitive)
- Broken access control
- Insecure direct object references (IDOR)
- Rate limiting bypasses

### Low (P4)
**Reward Range: $100 - $500**

- Cross-Site Scripting (XSS) - Reflected
- Information disclosure (minimal impact)
- Security misconfigurations
- Missing security headers
- Open redirects

### Informational
**Reward: Recognition + Swag**

- Best practices violations
- Code quality issues
- Documentation improvements

---

## Rewards

### Base Rewards

| Severity | Minimum | Maximum |
|----------|---------|---------|
| Critical | $5,000 | $10,000 |
| High | $2,000 | $5,000 |
| Medium | $500 | $2,000 |
| Low | $100 | $500 |

### Bonus Rewards

**🏆 First Blood Bonus:** +50% for first report of a vulnerability type
**🔥 Critical Chain Bonus:** +25% for chaining multiple vulnerabilities
**📝 Quality Report Bonus:** +10% for exceptionally detailed reports with PoC
**🎯 Zero-Day Bonus:** +100% for previously unknown vulnerability classes

### Recognition

- Hall of Fame listing on our security page
- CretoAI swag (t-shirts, stickers, etc.)
- LinkedIn recommendation from our security team
- Annual "Security Researcher of the Year" award ($5,000)

---

## Rules of Engagement

### ✅ DO:

1. **Report responsibly** - Submit all findings through official channels
2. **Provide detailed reports** - Include reproduction steps, impact assessment, and proof-of-concept
3. **Give us time** - Allow 90 days for remediation before public disclosure
4. **Test on approved environments** - Use staging.cretoai.io or request isolated test environment
5. **Act in good faith** - Respect user privacy and data integrity
6. **Follow disclosure timeline** - Coordinate public disclosure with our security team

### ❌ DON'T:

1. **Attack production** - Do not test on api.cretoai.io without explicit permission
2. **Access user data** - Do not view, modify, or exfiltrate user data
3. **Disrupt services** - Avoid DoS/DDoS attacks and resource exhaustion
4. **Spam or phish** - No social engineering or phishing attacks
5. **Violate laws** - Comply with all applicable laws and regulations
6. **Disclose prematurely** - Do not publicly disclose vulnerabilities before remediation

---

## Submission Process

### 1. Discovery
- Identify a potential security vulnerability
- Verify it's in scope and reproducible
- Document the vulnerability thoroughly

### 2. Report Submission
Submit reports via:
- **Email:** security@cretoai.io (PGP key: [link])
- **HackerOne:** https://hackerone.com/cretoai (coming Q2 2024)
- **Bugcrowd:** https://bugcrowd.com/cretoai (coming Q2 2024)

### 3. Required Information
Your report must include:
- **Summary:** Brief description of the vulnerability
- **Severity:** Your assessment (Critical/High/Medium/Low)
- **Affected Component:** Which system/endpoint is vulnerable
- **Reproduction Steps:** Detailed step-by-step instructions
- **Proof of Concept:** Code, screenshots, or video demonstrating the issue
- **Impact Assessment:** Potential consequences of exploitation
- **Suggested Remediation:** (Optional) How to fix the vulnerability

### 4. Report Template
```markdown
## Vulnerability Report

**Reporter:** [Your Name]
**Date:** [YYYY-MM-DD]
**Severity:** [Critical/High/Medium/Low]

### Summary
[Brief description]

### Affected Component
- **System:** [Consensus/Reputation/Compliance/API]
- **Endpoint:** [URL or function name]
- **Version:** [If known]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Proof of Concept
[Code, screenshots, or video]

### Impact
[What can an attacker achieve?]

### Suggested Fix
[Your recommendations]
```

### 5. Response Timeline
- **Initial Response:** Within 24 hours (business days)
- **Triage:** Within 72 hours
- **Validation:** Within 7 days
- **Remediation:** Critical (30 days), High (60 days), Medium (90 days)
- **Reward Payment:** Within 14 days of validation

---

## Testing Guidelines

### Approved Testing Environments

**Staging Environment:**
- URL: https://staging.cretoai.io
- Available 24/7 for security testing
- Data is synthetic and can be safely modified
- Reset daily at 00:00 UTC

**Isolated Test Environment:**
- Request via security@cretoai.io
- Dedicated Kubernetes namespace
- Full access to all features
- Available for 7 days per request

### Testing Limits

- **Rate Limiting:** 1000 requests/minute per IP
- **Concurrent Connections:** 100 per IP
- **Data Volume:** Max 1GB upload per test
- **Test Duration:** Max 8 hours consecutive testing

### Prohibited Activities

❌ Testing production environment (api.cretoai.io)
❌ Brute force attacks (password guessing)
❌ Network flooding or bandwidth exhaustion
❌ Exploitation of vulnerabilities for personal gain
❌ Destruction of data or systems

---

## Disclosure Policy

### Coordinated Disclosure Timeline

1. **Day 0:** Researcher submits vulnerability report
2. **Day 1:** CretoAI acknowledges receipt
3. **Day 7:** CretoAI validates and triages vulnerability
4. **Day 30-90:** CretoAI remediates vulnerability (severity-dependent)
5. **Day 90+:** Coordinated public disclosure

### Public Disclosure

We believe in transparency and will:
- Publish security advisories for all Critical/High findings
- Credit researchers (with permission) in advisories
- Share technical details after remediation
- Maintain a public security changelog

**Security Advisory Format:**
- CVE assignment (if applicable)
- Affected versions
- Impact assessment
- Remediation steps
- Credit to researcher

---

## Safe Harbor

CretoAI commits to:
- Not pursue legal action against researchers acting in good faith
- Work with you to understand and resolve vulnerabilities
- Recognize your contributions publicly (with your permission)

**Legal Protection:**
This program is conducted in accordance with:
- DMCA Section 1201(j) for security testing
- Computer Fraud and Abuse Act (CFAA) safe harbor
- Authorization to test under this policy

By participating, you agree to:
- Comply with all applicable laws
- Not share vulnerability details without permission
- Provide accurate information in reports

---

## Payment Process

### Eligibility
- Report must be original and previously unknown
- Vulnerability must be reproducible and valid
- Researcher must comply with all program rules
- No public disclosure before remediation

### Payment Methods
- PayPal
- Wire transfer (for rewards >$1,000)
- Cryptocurrency (BTC, ETH)
- Donation to charity of your choice

### Tax Reporting
- US-based researchers: W-9 required for payments >$600
- International researchers: W-8BEN may be required
- Tax obligations are researcher's responsibility

---

## Hall of Fame

### 2024 Top Researchers

| Rank | Researcher | Reports | Total Rewards |
|------|----------|---------|---------------|
| 🥇 1 | [TBD] | - | $0 |
| 🥈 2 | [TBD] | - | $0 |
| 🥉 3 | [TBD] | - | $0 |

*Program launching Q1 2024*

### Notable Findings

*To be populated as vulnerabilities are discovered and remediated*

---

## Contact Information

**Security Team Email:** security@cretoai.io
**PGP Key Fingerprint:** [TBD]
**PGP Public Key:** [TBD]

**Program Manager:** [TBD]
**Response Time:** 24 hours (business days)

**Social Media:**
- Twitter: @CretoAI_Security
- LinkedIn: CretoAI Security Team

---

## Frequently Asked Questions (FAQ)

**Q: Can I test the production environment?**
A: No, unless you receive explicit written permission. Use staging.cretoai.io instead.

**Q: How long does it take to receive a reward?**
A: Rewards are paid within 14 days of vulnerability validation.

**Q: What if my report is a duplicate?**
A: Only the first reporter of a unique vulnerability is eligible for a reward. Duplicates receive recognition only.

**Q: Can I submit anonymously?**
A: Yes, but you must provide a way to receive payment.

**Q: What happens if we disagree on severity?**
A: We'll work with you to understand your assessment. Final severity is determined by CretoAI based on actual risk and exploitability.

**Q: Are automated scan results eligible?**
A: Only if manually validated and include a working proof-of-concept.

**Q: Can I participate if I work for a competitor?**
A: Yes, but you must disclose your employer and ensure no conflicts of interest.

---

## Program Updates

**Version 1.0 (2024-01-01):** Initial program launch
- Base reward structure defined
- Scope and rules established
- Private program for invited researchers

**Planned Updates:**
- Q2 2024: Public program launch on HackerOne/Bugcrowd
- Q3 2024: Expanded scope to include mobile apps (if applicable)
- Q4 2024: Annual security researcher summit

---

## Legal

This bug bounty program is offered under the following terms:
- CretoAI reserves the right to modify or terminate the program at any time
- Rewards are discretionary and subject to validation
- Participation does not create an employment relationship
- All decisions regarding eligibility and rewards are final

**Terms of Service:** https://cretoai.io/terms
**Privacy Policy:** https://cretoai.io/privacy

---

**Thank you for helping us secure CretoAI!** 🔒
