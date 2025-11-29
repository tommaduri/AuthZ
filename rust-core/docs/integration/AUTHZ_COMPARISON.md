# Creto AuthZ Engine: Classical vs Quantum-Safe Comparison

## Executive Summary

This document provides a side-by-side comparison of classical HMAC-SHA256 signatures versus quantum-safe ML-DSA-87 signatures for Creto AuthZ Engine policy signing.

## Performance Comparison

| Metric | Classical (HMAC-SHA256) | Quantum-Safe (ML-DSA-87) | Hybrid Mode |
|--------|-------------------------|--------------------------|-------------|
| **Signing Time** | ~1-5 μs | ~150-300 μs | ~155-305 μs |
| **Verification Time** | ~1-5 μs | ~80-150 μs | ~85-155 μs |
| **Signature Size** | 32 bytes | 4,627 bytes | 4,659 bytes |
| **Public Key Size** | N/A (shared secret) | 2,592 bytes | 2,592 bytes |
| **Memory Overhead** | Minimal | ~7 KB per policy | ~7 KB per policy |
| **CPU Overhead** | Baseline | ~5-8% | ~8-12% |

## Security Guarantees

### Classical HMAC-SHA256

✅ **Strengths:**
- Well-established and battle-tested
- Fast performance on all hardware
- Minimal resource requirements
- Wide library support

❌ **Weaknesses:**
- Vulnerable to quantum attacks (Grover's algorithm)
- Security degrades to 128-bit post-quantum
- Shared secret distribution challenges
- No forward secrecy for policies

**Security Horizon:** ~2030-2035 (classical computers only)

### Quantum-Safe ML-DSA-87

✅ **Strengths:**
- Resistant to quantum attacks (Shor's & Grover's algorithms)
- NIST FIPS 204 standardized
- Public-key infrastructure (no shared secrets)
- Forward secrecy for historical policies
- NIST Security Level 5 (highest available)

❌ **Weaknesses:**
- Larger signatures (~145x classical)
- Slightly slower performance (~50-60x classical)
- Newer standard (less deployment history)
- Higher storage requirements

**Security Horizon:** 2050+ (quantum & classical computers)

### Hybrid Mode

✅ **Strengths:**
- Best of both worlds during migration
- Backward compatibility with classical systems
- Gradual rollout without breaking changes
- Fallback to classical if quantum verification fails
- Smooth transition path

❌ **Weaknesses:**
- Highest storage overhead
- Requires maintaining both signature schemes
- Temporary complexity increase
- Not a long-term solution

**Security Horizon:** Inherits quantum-safe timeline (2050+)

## Migration Path

### Phase 1: Hybrid Deployment (Days 0-30)

**Goal:** Deploy quantum-safe infrastructure alongside classical

```
┌─────────────────────────────────────────────┐
│           AuthZ Engine                      │
│  ┌──────────────┐    ┌──────────────┐      │
│  │  Classical   │    │ Quantum-Safe │      │
│  │   Signer     │◄───┤   Signer     │      │
│  └──────────────┘    └──────────────┘      │
│         │                    │              │
│         └──────┬─────────────┘              │
│                ▼                            │
│         Hybrid Signature                    │
│     (both classical + PQC)                  │
└─────────────────────────────────────────────┘
```

**Actions:**
1. Install CretoAI crypto library
2. Enable hybrid mode in AuthZ config
3. Test with low-traffic policies
4. Monitor performance metrics
5. Validate signature verification

**Success Criteria:**
- < 15% performance overhead
- 100% signature verification success
- No service disruptions

### Phase 2: Gradual Migration (Days 31-60)

**Goal:** Migrate policies to quantum-safe signatures

```
Migration Strategy:
┌────────────────────────────────────────────┐
│  Policy Risk Assessment                    │
├────────────────────────────────────────────┤
│  Critical Policies (10%)                   │
│    → Migrate first (Days 31-40)            │
│                                            │
│  High-Value Policies (30%)                 │
│    → Migrate second (Days 41-50)           │
│                                            │
│  Standard Policies (60%)                   │
│    → Migrate last (Days 51-60)             │
└────────────────────────────────────────────┘
```

**Actions:**
1. Categorize policies by risk level
2. Migrate critical policies first
3. Monitor storage growth
4. Optimize signature compression
5. Update documentation

**Success Criteria:**
- 80%+ policies on quantum-safe signatures
- Storage growth < 2x baseline
- Zero security incidents

### Phase 3: Classical Deprecation (Days 61-90)

**Goal:** Remove classical signature support

```
Deprecation Timeline:
Day 61: Announce classical deprecation
Day 70: Disable classical signing (verification only)
Day 80: Log warnings for classical signatures
Day 90: Remove classical support entirely
```

**Actions:**
1. Migrate remaining policies
2. Disable classical signature creation
3. Maintain verification for legacy policies
4. Archive classical signatures
5. Clean up codebase

**Success Criteria:**
- 100% quantum-safe signatures
- Clean removal of classical code
- No breaking changes for clients

## Backward Compatibility

### API Compatibility Matrix

| Feature | Classical | Hybrid | Quantum-Safe |
|---------|-----------|--------|--------------|
| Policy creation | ✅ | ✅ | ✅ |
| Policy verification | ✅ | ✅ | ✅ |
| Cross-verification | ❌ | ✅ | ❌ |
| Legacy policy support | ✅ | ✅ | ⚠️ (archive) |
| New client support | ✅ | ✅ | ✅ |

### Client Migration Requirements

**Minimum Changes:**
- Update AuthZ client library to v2.0+
- Enable quantum-safe mode in config
- Re-provision agent credentials

**No Changes Required:**
- Policy schema (same JSON/YAML format)
- REST API endpoints
- Database schema (signature stored as BLOB)
- Monitoring/observability

## Cost-Benefit Analysis

### Infrastructure Costs

**Storage:**
- Per policy overhead: ~7 KB
- For 1M policies: ~7 GB additional storage
- Annual storage cost (AWS S3): ~$1.60/year
- **Verdict:** Negligible

**Compute:**
- CPU overhead: ~5-8%
- For 1000 req/s workload: +50-80 req/s equivalent
- Horizontal scaling: +1 server per 10 servers
- **Verdict:** Minimal (< 10% infrastructure cost)

**Network:**
- Signature transmission: +4.6 KB per policy
- For 1M policy distributions/day: +4.6 GB/day
- Annual bandwidth cost: ~$400/year
- **Verdict:** Negligible

### Security Benefits

**Risk Mitigation:**
- Quantum attack protection: **Priceless**
- Compliance (NIST PQC): **Required by 2030**
- Future-proof architecture: **5-10 year advantage**
- Zero-trust compatibility: **Strategic**

**Incident Cost Avoidance:**
- Average data breach: $4.45M (IBM 2023)
- Quantum attack on auth: Catastrophic
- Early adoption advantage: Competitive differentiator

### ROI Calculation

```
Annual Cost: ~$400-500 (storage + bandwidth)
Risk Mitigation Value: $4.45M+ (breach avoidance)
ROI: ~890,000% over classical baseline
```

**Conclusion:** Migration pays for itself if it prevents a single quantum-enabled breach.

## Performance Optimization Tips

### 1. Signature Caching
```rust
// Cache verified signatures for policy reuse
let signature_cache = LruCache::new(10_000);
if let Some(cached) = signature_cache.get(&policy_id) {
    return Ok(cached.clone());
}
```

### 2. Batch Verification
```rust
// Verify multiple policies in parallel
let futures = policies.iter()
    .map(|p| async { verify_quantum_safe(p).await })
    .collect();
tokio::join_all(futures).await;
```

### 3. Hardware Acceleration
```rust
// Use AVX2/AVX-512 for ML-DSA operations
#[cfg(target_feature = "avx2")]
fn accelerated_verify(sig: &[u8]) -> bool {
    // AVX2-optimized verification
}
```

### 4. Compression
```rust
// Compress signatures for storage/transmission
let compressed = zstd::encode_all(&signature, 3)?;
// Typical compression: 4,627 → ~3,200 bytes (30% reduction)
```

## Compliance & Standards

### Current Standards
- **NIST FIPS 204:** ML-DSA (August 2024)
- **CNSA 2.0:** Quantum-safe by 2030 (NSA)
- **ISO/IEC 14888-3:** Digital signatures
- **RFC 8391:** Post-quantum signatures

### Future Roadmap
- **2025:** NIST releases final ML-DSA specifications
- **2026:** Browser support for PQC signatures
- **2030:** US Government mandate for PQC
- **2035:** Classical crypto deprecated

## Frequently Asked Questions

### Q: Can I roll back to classical if needed?
**A:** Yes, during hybrid mode (Phase 1-2). After Phase 3, rollback requires policy re-signing.

### Q: What happens to policies signed classically?
**A:** They remain verifiable in hybrid mode. Post-migration, they're archived or re-signed.

### Q: Is ML-DSA-87 overkill for AuthZ?
**A:** For long-lived policies (> 5 years), no. For ephemeral policies, consider ML-DSA-65 (smaller).

### Q: How does this affect policy revocation?
**A:** No change. Revocation lists work identically for both signature types.

### Q: Can I use different PQC algorithms?
**A:** Yes, but ML-DSA-87 is NIST-recommended for highest security level.

## Resources

- **NIST PQC:** https://csrc.nist.gov/projects/post-quantum-cryptography
- **ML-DSA Spec:** https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.204.pdf
- **CretoAI Docs:** https://github.com/cretohq/cretoai
- **AuthZ Migration Guide:** See MIGRATION_PLAYBOOK.md

## Contact & Support

- **Technical Questions:** support@creto.ai
- **Migration Assistance:** authz-migration@creto.ai
- **Security Concerns:** security@creto.ai
