# CretoAI Documentation Index

**Version:** 1.0.0
**Phase:** 6 (90% Complete)
**Last Updated:** 2025-11-28

---

## 🚀 Quick Links

- **[Project Status](../STATUS.md)** - Current state & roadmap
- **[Getting Started](../GETTING_STARTED.md)** - 5-minute quick start
- **[Phase 6 Status](PHASE_6_STATUS.md)** - Detailed implementation status (90%)

---

## 📚 Documentation Structure

### 1. Getting Started

**New Users Start Here:**
- [Quick Start (5 min)](../GETTING_STARTED.md) - Get running immediately
- [Docker Deployment](../QUICKSTART_DOCKER.md) - Production Docker setup
- [Kubernetes Deployment](../QUICKSTART_K8S.md) - K8s cluster deployment
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute

### 2. Architecture

**System Design & Planning:**
- [Phase 6 Plan](architecture/PHASE_6_PLAN.md) - Complete roadmap & specifications
- [Node Architecture](architecture/NODE_ARCHITECTURE.md) - Consensus node design (1,900 lines)
- [AuthZ Integration](architecture/authz-integration.md) - Creto AuthZ integration
- [REST API SDD](architecture/phase-5-rest-api-sdd.md) - API design document
- [Core SDD](architecture/CRETOAI-CORE-SDD.md) - Core system design
- [Phase 5 Pivot](architecture/PHASE_5_PIVOT.md) - Customer presentation layer

### 3. Implementation Guides

**Technical Implementation Details:**
- [RocksDB Storage](storage/PHASE_6_STORAGE.md) - Complete storage implementation
- [Storage Quick Start](storage/PHASE_6_QUICKSTART.md) - 5-minute storage setup
- [Docker Status](PHASE5_DOCKER_STATUS.md) - Deployment readiness
- [Phase 6 Network](architecture/PHASE_6_NETWORK_IMPLEMENTATION.md) - QUIC networking

### 4. Testing

**Comprehensive Testing Guides:**
- [E2E Testing Guide](../tests/e2e/README.md) - 24 comprehensive tests
- [E2E Test Report](../tests/e2e/TEST_REPORT.md) - Technical analysis (584 lines)
- [Test Deliverables](../tests/e2e/DELIVERABLES.md) - Quick reference
- [Security Tests](../tests/security/README.md) - Security validation
- [Scale Tests](../tests/scale/README.md) - Performance & load testing

### 5. Performance & Benchmarks

**Validated Performance Data:**
- [Benchmark Overview](benchmarks/README.md) - Complete benchmarking guide
- [Performance Results](benchmarks/PERFORMANCE_RESULTS.md) - Published results
- [Charts Index](benchmarks/CHARTS_INDEX.md) - Visual performance data
- [Quick Reference](benchmarks/QUICK_REFERENCE.md) - Key metrics summary

**Benchmark Results:**
- **ML-DSA-87 Signing:** 56,000+ TPS
- **ML-KEM-768 Encryption:** 25,000+ TPS
- **Simulated Consensus:** 10,000+ TPS (177ms finality)

### 6. Deployment

**Production Deployment Guides:**
- [Docker Quick Start](../QUICKSTART_DOCKER.md) - Get running in 5 minutes
- [Kubernetes Guide](../k8s/README.md) - Production k8s deployment
- [Helm Charts](../charts/cretoai/README.md) - Parameterized deployment
- [Deployment Summary](deployment/DEPLOYMENT_SUMMARY.md) - Overview
- [Kubernetes Deployment](deployment/KUBERNETES_DEPLOYMENT.md) - Detailed k8s guide
- [Migration Script](../scripts/migrate-to-rocksdb.sh) - Phase 5 → Phase 6 migration

### 7. Business & Presentations

**Customer-Facing Materials:**
- [Executive Summary](presentations/EXECUTIVE_SUMMARY.md) - High-level overview
- [Demo Guide](presentations/DEMO_GUIDE.md) - 5-minute demo script
- [Video Script](presentations/VIDEO_SCRIPT.md) - Presentation video
- [FAQ](presentations/FAQ.md) - Frequently asked questions

### 8. Integration

**AuthZ & External Systems:**
- [AuthZ Comparison](integration/AUTHZ_COMPARISON.md) - Classical vs Quantum-resistant
- [Migration Playbook](integration/MIGRATION_PLAYBOOK.md) - Migration guide
- [Quick Start](integration/QUICK_START.md) - Integration quick start
- [1KOSMOS Integration](integrations/1KOSMOS_INTEGRATION_ARCHITECTURE.md) - Identity integration

### 9. Security & Compliance

**Security Documentation:**
- [Security Policy](../SECURITY.md) - Vulnerability reporting
- [Security Review](reviews/SECURITY_STATUS.md) - Security audit results
- [Security Quick Ref](reviews/SECURITY_QUICK_REF.md) - Security checklist

### 10. Business Development

**Go-to-Market Strategy:**
- [Week 1 BD Strategy](business/WEEK1_BD_STRATEGY.md) - Business development plan

### 11. Use Cases

**Industry Applications:**
- [Fintech](use-cases/FINTECH.md) - Financial services use cases
- [Government](use-cases/GOVERNMENT.md) - Government & classified networks
- [Healthcare](use-cases/HEALTHCARE.md) - Healthcare compliance (HIPAA + quantum)

### 12. Historical Documentation

**Archive Location:** `docs/archive/`

Phase-specific documentation has been archived for historical reference:
- `archive/phases-1-4/` - General implementation plans and early documents
- `archive/phase-2-quic/` - QUIC transport development (11 files)
- `archive/phase-3-consensus/` - Consensus implementation (12 files)
- `archive/phase-4-security/` - Security hardening (9 files)

**See:** [Archive README](archive/README.md) for details

---

## 🎯 What to Read First

### For Developers

1. **[Getting Started](../GETTING_STARTED.md)** - Get running in 5 minutes
2. **[Node Architecture](architecture/NODE_ARCHITECTURE.md)** - Understand the consensus node
3. **[E2E Testing](../tests/e2e/README.md)** - Run comprehensive tests
4. **[Storage Guide](storage/PHASE_6_STORAGE.md)** - Persistent DAG with RocksDB
5. **[Contributing](../CONTRIBUTING.md)** - Submit your first PR

### For DevOps

1. **[Docker Quick Start](../QUICKSTART_DOCKER.md)** - Deploy in 5 minutes
2. **[Kubernetes Guide](../k8s/README.md)** - Production k8s setup
3. **[Storage Quick Start](storage/PHASE_6_QUICKSTART.md)** - RocksDB setup
4. **[Helm Charts](../charts/cretoai/README.md)** - Parameterized deployment
5. **[Deployment Summary](deployment/DEPLOYMENT_SUMMARY.md)** - Overview

### For Executives

1. **[Project Status](../STATUS.md)** - Current state (Phase 6 90% complete)
2. **[Executive Summary](presentations/EXECUTIVE_SUMMARY.md)** - High-level overview
3. **[Performance Results](benchmarks/PERFORMANCE_RESULTS.md)** - Validated benchmarks
4. **[Demo Guide](presentations/DEMO_GUIDE.md)** - 5-minute demo
5. **[FAQ](presentations/FAQ.md)** - Common questions

### For Security Auditors

1. **[Security Policy](../SECURITY.md)** - Vulnerability reporting
2. **[Security Status](reviews/SECURITY_STATUS.md)** - Audit results
3. **[Security Quick Ref](reviews/SECURITY_QUICK_REF.md)** - Security checklist
4. **[Phase 6 Status](PHASE_6_STATUS.md)** - Current implementation
5. **[Node Architecture](architecture/NODE_ARCHITECTURE.md)** - System design

---

## 📊 Documentation Statistics

**Total Active Documentation:** ~50 files
**Phase 6 Documentation:** 10 key files
**Archived Documentation:** 40+ files (Phases 1-4)
**Architecture Docs:** 3,300+ lines
**Test Documentation:** 1,900+ lines

---

## 🗂️ Version History

- **1.0.0** (2025-11-28) - Phase 6 90% complete, documentation cleanup
- **0.9.0** (2025-11-27) - Phase 6 consensus node implementation
- **0.8.0** (2025-11-26) - Phase 5 REST API & benchmarks
- **0.7.0** (2025-11-25) - Phase 4 security hardening
- **0.6.0** (2025-11-24) - Phase 3 consensus implementation
- **0.5.0** (2025-11-23) - Phase 2 QUIC transport

---

## 📞 Support

**Issues:** https://github.com/Creto-Systems/Creto-AI/issues
**Security:** security@cretoai.ai
**Contributing:** [CONTRIBUTING.md](../CONTRIBUTING.md)
**Documentation Issues:** Label issues with `documentation`

---

## 🔍 Finding What You Need

**Search Tips:**
- Use GitHub's file search: Press `/` then type filename
- Grep documentation: `grep -r "keyword" docs/`
- Check [Project Status](../STATUS.md) for current features
- See [Phase 6 Status](PHASE_6_STATUS.md) for implementation details

**Can't find what you're looking for?**
- Check the [Archive](archive/README.md) for historical documentation
- Search [Issues](https://github.com/Creto-Systems/Creto-AI/issues)
- Ask in [Discussions](https://github.com/Creto-Systems/Creto-AI/discussions)

---

**Documentation maintained with ❤️ by the CretoAI team**
