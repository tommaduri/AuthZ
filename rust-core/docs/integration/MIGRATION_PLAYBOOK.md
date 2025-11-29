# Creto AuthZ Engine: Quantum-Safe Migration Playbook

## Overview

This playbook guides you through migrating Creto AuthZ Engine from classical HMAC-SHA256 signatures to quantum-safe ML-DSA-87 signatures using a phased hybrid approach.

**Total Timeline:** 90 days
**Downtime Required:** Zero
**Risk Level:** Low (hybrid mode ensures backward compatibility)

---

## Pre-Migration Checklist

### ✅ Infrastructure Readiness

- [ ] Review current AuthZ deployment architecture
- [ ] Audit current policy database (count, size, frequency)
- [ ] Baseline performance metrics (signing time, verification time)
- [ ] Storage capacity planning (+7 KB per policy)
- [ ] Network bandwidth assessment (+4.6 KB signature overhead)
- [ ] Backup current policy database
- [ ] Test disaster recovery procedures

### ✅ Team Preparation

- [ ] Assign migration owner (DevOps/Security lead)
- [ ] Train team on PQC concepts
- [ ] Review migration playbook with stakeholders
- [ ] Set up monitoring dashboards
- [ ] Define rollback criteria
- [ ] Schedule bi-weekly sync meetings

### ✅ Dependency Check

- [ ] Install CretoAI crypto library (v1.0.0+)
- [ ] Update AuthZ engine to v2.0+ (hybrid mode support)
- [ ] Verify client library compatibility
- [ ] Test in staging environment
- [ ] Run integration tests
- [ ] Security audit of new crypto stack

---

## Phase 1: Hybrid Deployment (Days 0-30)

**Goal:** Deploy quantum-safe infrastructure alongside classical with zero disruption.

### Day 0-7: Installation & Configuration

#### Step 1.1: Install CretoAI Library

```bash
# Add CretoAI dependency to AuthZ engine
cd /path/to/authz-engine
cargo add cretoai-crypto --features ml-dsa-87

# Or for Python-based deployments
pip install cretoai-crypto

# Verify installation
cargo test --features ml-dsa-87
```

#### Step 1.2: Configure Hybrid Mode

```yaml
# authz-config.yaml
signature:
  mode: hybrid                    # Enable dual-signature mode
  classical:
    algorithm: hmac-sha256
    secret_key_env: AUTHZ_SECRET_KEY
  quantum_safe:
    algorithm: ml-dsa-87
    key_storage: /etc/authz/pqc-keys
    key_rotation_days: 90

  # Hybrid behavior
  signing:
    create_both: true             # Sign with both algorithms
    primary: quantum_safe         # Prefer PQC for new policies

  verification:
    accept_classical: true        # Accept classical signatures
    accept_quantum_safe: true     # Accept PQC signatures
    require_both: false           # Don't require dual signatures yet
```

#### Step 1.3: Deploy to Staging

```bash
# Deploy hybrid-enabled AuthZ to staging
kubectl apply -f k8s/authz-hybrid-staging.yaml

# Run smoke tests
./scripts/test-hybrid-mode.sh

# Verify both signature types work
curl -X POST https://staging.authz.example.com/policies \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "test-agent",
    "resource": "test-resource",
    "action": "read",
    "signature_mode": "hybrid"
  }'
```

### Day 8-14: Canary Deployment

#### Step 1.4: Deploy to 5% Production Traffic

```yaml
# k8s/authz-canary.yaml
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: authz-engine
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: authz-engine
  service:
    port: 8080
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 5              # Only 5% traffic to start
    stepWeight: 1
    metrics:
    - name: request-success-rate
      thresholdRange:
        min: 99
    - name: signature-verification-rate
      thresholdRange:
        min: 100              # Must verify 100% signatures
```

#### Step 1.5: Monitor Canary Metrics

```bash
# Watch canary deployment
kubectl get canary authz-engine -w

# Check signature verification rates
kubectl logs -f deploy/authz-engine | grep "signature_verification"

# Monitor performance impact
curl https://metrics.example.com/authz/signing_latency
```

**Success Criteria:**
- ✅ 100% signature verification success
- ✅ < 15% latency increase
- ✅ No errors in logs
- ✅ Storage growth < 10% over baseline

### Day 15-21: Gradual Rollout

#### Step 1.6: Increase to 25%, 50%, 100%

```bash
# Day 15: 25% traffic
kubectl patch canary/authz-engine --type merge \
  -p '{"spec":{"analysis":{"maxWeight":25}}}'

# Day 18: 50% traffic
kubectl patch canary/authz-engine --type merge \
  -p '{"spec":{"analysis":{"maxWeight":50}}}'

# Day 21: 100% traffic (full rollout)
kubectl patch canary/authz-engine --type merge \
  -p '{"spec":{"analysis":{"maxWeight":100}}}'
```

### Day 22-30: Validation & Monitoring

#### Step 1.7: Comprehensive Validation

```bash
# Run full integration test suite
./tests/integration/hybrid-mode-suite.sh

# Validate policy lifecycle
./tests/policy-lifecycle-test.sh \
  --signature-mode hybrid \
  --policies 10000 \
  --duration 24h

# Performance benchmarking
./tests/benchmarks/signature-perf.sh > reports/hybrid-perf.json
```

#### Step 1.8: Create Monitoring Dashboards

```yaml
# grafana-dashboard.json
{
  "dashboard": {
    "title": "AuthZ Hybrid Mode Metrics",
    "panels": [
      {
        "title": "Signature Type Distribution",
        "targets": [
          "sum by (signature_type) (authz_signatures_created_total)"
        ]
      },
      {
        "title": "Verification Success Rate",
        "targets": [
          "rate(authz_signature_verifications_success[5m]) / rate(authz_signature_verifications_total[5m])"
        ]
      },
      {
        "title": "Signing Latency P95",
        "targets": [
          "histogram_quantile(0.95, authz_signing_duration_seconds_bucket)"
        ]
      }
    ]
  }
}
```

**Phase 1 Deliverables:**
- ✅ Hybrid mode running in production
- ✅ Both signature types working
- ✅ Monitoring dashboards operational
- ✅ Performance baseline documented

---

## Phase 2: Gradual Migration (Days 31-60)

**Goal:** Migrate policies to quantum-safe signatures based on risk tier.

### Day 31-40: Critical Policies (Tier 1)

#### Step 2.1: Identify Critical Policies

```sql
-- Query to identify critical policies
SELECT policy_id, subject, resource, action, risk_score
FROM authz_policies
WHERE risk_score >= 9.0           -- Critical policies
   OR resource LIKE '%/critical/%'
   OR resource LIKE '%/admin/%'
ORDER BY risk_score DESC
LIMIT 1000;                        -- ~10% of policies
```

#### Step 2.2: Migrate Critical Policies

```bash
# Migration script for critical policies
./scripts/migrate-policies.sh \
  --tier critical \
  --signature quantum-safe \
  --batch-size 100 \
  --dry-run false \
  --verify true

# Output:
# ✅ Migrated 1000 critical policies
# ✅ Verification: 100% success
# ⏱️  Average time: 250ms per policy
# 💾 Storage increase: 7.0 MB
```

#### Step 2.3: Validate Migration

```bash
# Verify critical policies are quantum-safe signed
./scripts/validate-migration.sh --tier critical

# Sample output:
# Policy ID: pol_critical_001
#   Old Signature: HMAC-SHA256 (32 bytes)
#   New Signature: ML-DSA-87 (4627 bytes)
#   Verification: ✅ PASSED (both signatures valid)
#   Status: ✅ MIGRATED
```

### Day 41-50: High-Value Policies (Tier 2)

#### Step 2.4: Migrate High-Value Policies

```sql
-- High-value policies (30% of total)
SELECT policy_id, subject, resource, action, risk_score
FROM authz_policies
WHERE risk_score >= 7.0 AND risk_score < 9.0
   OR resource LIKE '%/sensitive/%'
ORDER BY risk_score DESC
LIMIT 3000;
```

```bash
# Migrate high-value policies
./scripts/migrate-policies.sh \
  --tier high-value \
  --signature quantum-safe \
  --batch-size 500 \
  --parallel-workers 4

# Monitor migration progress
watch -n 5 './scripts/migration-status.sh'
```

### Day 51-60: Standard Policies (Tier 3)

#### Step 2.5: Migrate Remaining Policies

```bash
# Migrate all remaining policies
./scripts/migrate-policies.sh \
  --tier standard \
  --signature quantum-safe \
  --batch-size 1000 \
  --parallel-workers 8 \
  --aggressive true

# Expected output:
# 📊 Progress: [████████████████████] 100%
# ✅ Migrated: 6000 policies
# ⚠️  Warnings: 3 policies require manual review
# ❌ Failed: 0 policies
# ⏱️  Total time: 2h 15m
```

#### Step 2.6: Handle Edge Cases

```bash
# Review warnings from migration
./scripts/migration-warnings.sh

# Example warning:
# Policy pol_edge_001: Circular dependency detected
#   Action: Manual review required
#   Recommendation: Split into separate policies

# Manually fix edge cases
./scripts/fix-policy.sh pol_edge_001 --split-dependency
./scripts/migrate-policies.sh --policy-id pol_edge_001 --force
```

**Phase 2 Deliverables:**
- ✅ 80%+ policies on quantum-safe signatures
- ✅ Critical policies fully migrated
- ✅ Edge cases documented and resolved
- ✅ Migration audit trail complete

---

## Phase 3: Classical Deprecation (Days 61-90)

**Goal:** Remove classical signature support entirely.

### Day 61-70: Announce Deprecation

#### Step 3.1: Update Configuration

```yaml
# authz-config.yaml (updated)
signature:
  mode: quantum-safe-only        # Deprecate classical
  classical:
    enabled: false               # Disable classical signing
    verification_only: true      # Allow verification for legacy
    deprecation_warning: true    # Log warnings
  quantum_safe:
    algorithm: ml-dsa-87
    enforce: true                # Require PQC signatures
```

#### Step 3.2: Notify Clients

```bash
# Send deprecation notices
./scripts/notify-clients.sh \
  --subject "AuthZ Classical Signatures Deprecated" \
  --template deprecation-notice.html \
  --recipients authz-clients@example.com

# Deprecation notice content:
# - Classical signing disabled (Day 70)
# - Verification remains for 90 days
# - Upgrade to quantum-safe required
# - Migration support available
```

### Day 71-80: Disable Classical Signing

#### Step 3.3: Deploy Quantum-Safe-Only Mode

```bash
# Deploy updated configuration
kubectl apply -f k8s/authz-quantum-only.yaml

# Test that classical signing fails gracefully
curl -X POST https://authz.example.com/policies \
  -H "Content-Type: application/json" \
  -d '{"signature_mode": "classical"}' \
  | jq

# Expected response:
# {
#   "error": "classical_signing_deprecated",
#   "message": "Classical HMAC-SHA256 signatures are deprecated. Use quantum-safe ML-DSA-87.",
#   "migration_guide": "https://docs.creto.ai/authz/migration"
# }
```

#### Step 3.4: Monitor Legacy Usage

```bash
# Track remaining classical signature verifications
kubectl logs -f deploy/authz-engine | grep "classical_verification"

# Alert if classical usage exceeds threshold
./scripts/setup-alerts.sh \
  --metric authz_classical_verifications_total \
  --threshold 100/day \
  --action notify-ops
```

### Day 81-90: Complete Removal

#### Step 3.5: Archive Legacy Policies

```bash
# Archive policies still using classical signatures
./scripts/archive-classical-policies.sh \
  --older-than 90d \
  --destination s3://authz-archives/classical/ \
  --compress true

# Archive summary:
# 📦 Archived: 47 policies
# 💾 Archive size: 2.3 MB (compressed)
# 🔒 Encryption: AES-256-GCM
# ⏰ Retention: 7 years
```

#### Step 3.6: Remove Classical Code

```bash
# Remove classical signature code from codebase
git checkout -b remove-classical-signatures

# Delete classical implementation
rm src/signatures/classical.rs
rm src/signatures/hmac_sha256.rs
rm tests/classical_signatures_test.rs

# Update dependencies
sed -i '/hmac =/d' Cargo.toml
sed -i '/sha2 =/d' Cargo.toml

# Rebuild and test
cargo build --release
cargo test --all-features

# Commit and deploy
git commit -m "Remove classical signature support (Phase 3 complete)"
git push origin remove-classical-signatures
```

#### Step 3.7: Final Validation

```bash
# Verify no classical code remains
./scripts/audit-codebase.sh --check-classical

# Output:
# ✅ No classical signature code found
# ✅ All policies use ML-DSA-87
# ✅ Storage optimized (compressed signatures)
# ✅ Performance within acceptable range (<10% overhead)

# Generate migration report
./scripts/migration-report.sh > reports/migration-final.md
```

**Phase 3 Deliverables:**
- ✅ 100% quantum-safe signatures
- ✅ Classical code removed
- ✅ Legacy policies archived
- ✅ Final audit report

---

## Rollback Procedures

### Scenario 1: Performance Degradation

**Trigger:** Signing latency exceeds 500ms P95

```bash
# Immediate rollback to hybrid mode
kubectl rollout undo deployment/authz-engine

# Re-enable classical as primary
kubectl set env deployment/authz-engine \
  AUTHZ_SIGNATURE_PRIMARY=classical

# Investigate performance issue
./scripts/debug-performance.sh --profile quantum-safe
```

### Scenario 2: Verification Failures

**Trigger:** Signature verification success rate < 99%

```bash
# Fallback to classical verification
kubectl patch configmap authz-config --type merge \
  -p '{"data":{"AUTHZ_FALLBACK_CLASSICAL":"true"}}'

# Restart pods
kubectl rollout restart deployment/authz-engine

# Debug verification failures
./scripts/debug-verification.sh --sample-size 1000
```

### Scenario 3: Storage Exhaustion

**Trigger:** Storage usage exceeds 90% capacity

```bash
# Enable signature compression
kubectl set env deployment/authz-engine \
  AUTHZ_COMPRESS_SIGNATURES=true \
  AUTHZ_COMPRESSION_LEVEL=6

# Compress existing signatures
./scripts/compress-signatures.sh --batch-size 10000

# Monitor storage reduction
watch -n 60 'df -h /var/lib/authz/policies'
```

---

## Post-Migration Tasks

### ✅ Documentation Updates

- [ ] Update API documentation with PQC signature format
- [ ] Publish migration case study
- [ ] Update client SDKs with quantum-safe examples
- [ ] Create troubleshooting guide

### ✅ Security Audit

- [ ] External security review of PQC implementation
- [ ] Penetration testing with quantum attack simulations
- [ ] Compliance certification (NIST FIPS 204)
- [ ] Update security.txt with PQC disclosure

### ✅ Performance Optimization

- [ ] Implement signature caching (10-20% speedup)
- [ ] Enable hardware acceleration (AVX2/AVX-512)
- [ ] Optimize database indexes for larger signatures
- [ ] Benchmark against industry standards

### ✅ Team Training

- [ ] PQC fundamentals workshop
- [ ] Incident response for quantum-safe systems
- [ ] Key rotation procedures
- [ ] Long-term maintenance plan

---

## Success Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Migration completion | 100% policies | _TBD_ |
| Downtime during migration | 0 minutes | _TBD_ |
| Signature verification success | > 99.9% | _TBD_ |
| Performance overhead | < 10% | _TBD_ |
| Storage increase | < 2x baseline | _TBD_ |
| Security incidents | 0 | _TBD_ |
| Client-reported issues | < 5 | _TBD_ |

---

## Timeline Summary

```
Day 0   ─────────────────────────────────────────────────┐
         Phase 1: Hybrid Deployment                      │
Day 30  ─────────────────────────────────────────────────┤
         Phase 2: Gradual Migration                      │
         ├─ Day 31-40: Critical policies (10%)           │
         ├─ Day 41-50: High-value policies (30%)         │
         └─ Day 51-60: Standard policies (60%)           │
Day 60  ─────────────────────────────────────────────────┤
         Phase 3: Classical Deprecation                  │
         ├─ Day 61-70: Announce & disable signing        │
         ├─ Day 71-80: Monitor legacy usage              │
         └─ Day 81-90: Archive & remove code             │
Day 90  ─────────────────────────────────────────────────┘
         ✅ MIGRATION COMPLETE
```

---

## Contact & Support

**Migration Owner:** [Your Name]
**Email:** authz-migration@creto.ai
**Slack:** #authz-pqc-migration
**Office Hours:** Tuesdays 2-3pm PT

**Escalation Path:**
1. Team Lead (< 1 hour response)
2. Security Team (< 4 hours response)
3. CretoAI Support (< 24 hours response)

---

## Appendix: Scripts

All migration scripts referenced in this playbook are available at:

```
/scripts/
├── migrate-policies.sh           # Policy migration automation
├── migration-status.sh           # Progress tracking
├── migration-warnings.sh         # Edge case reporting
├── validate-migration.sh         # Post-migration validation
├── archive-classical-policies.sh # Legacy archival
├── compress-signatures.sh        # Storage optimization
└── migration-report.sh           # Final report generation
```

**License:** MIT
**Version:** 1.0.0
**Last Updated:** 2025-01-27
