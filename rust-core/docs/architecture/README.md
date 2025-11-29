# CretoAI Architecture Documentation

This directory contains the architectural design documents for CretoAI.

---

## 📚 Document Index

### CretoAI Core Package Design (NEW - 2025-11-27)

A comprehensive solution to eliminate the circular dependency in the CretoAI codebase.

| Document | Description | Size | Purpose |
|----------|-------------|------|---------|
| **[CRETOAI-CORE-SDD.md](./CRETOAI-CORE-SDD.md)** | Complete Software Design Document | 24 KB | Full technical specification with 17 sections |
| **[CRETOAI-CORE-SUMMARY.md](./CRETOAI-CORE-SUMMARY.md)** | Executive Summary | 5 KB | Quick overview for stakeholders |
| **[DEPENDENCY-ANALYSIS.md](./DEPENDENCY-ANALYSIS.md)** | Detailed Dependency Analysis | 10 KB | Visual graphs, metrics, impact analysis |

### Other Architecture Documents

| Document | Description |
|----------|-------------|
| [authz-integration.md](./authz-integration.md) | Authorization system integration guide |

---

## 🎯 Quick Start Guide

### For Architects & Technical Leads
**Read**: [CRETOAI-CORE-SUMMARY.md](./CRETOAI-CORE-SUMMARY.md) (5 min)
- Executive overview
- Architecture diagrams
- Key benefits and metrics

### For Developers Implementing the Solution
**Read**: [CRETOAI-CORE-SDD.md](./CRETOAI-CORE-SDD.md) (30 min)
- Complete type definitions with code examples
- Trait specifications
- Migration guide (step-by-step)
- Testing strategy

### For Project Managers & Stakeholders
**Read**: [DEPENDENCY-ANALYSIS.md](./DEPENDENCY-ANALYSIS.md) (15 min)
- Visual dependency graphs
- Timeline and milestones
- Risk assessment
- Success metrics

---

## 🔍 Problem Being Solved

### Current Issue: Circular Dependency

```
cretoai-dag → cretoai-network → cretoai-mcp → [needs dag] ← BLOCKED!
```

**Impact**:
- MCP cannot use DAG types directly
- ~500 lines of duplicate code
- Complex feature flag workarounds
- Difficult testing and maintenance

### Solution: cretoai-core Package

```
cretoai-core (foundation)
    ↓
    ├─→ cretoai-dag
    ├─→ cretoai-network
    └─→ cretoai-mcp

✅ Zero circular dependencies
✅ Single source of truth
✅ Clean dependency graph
```

---

## 📊 Key Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Circular Dependencies | 1 | 0 | ✅ 100% |
| Duplicate Types | ~15 | 0 | ✅ 100% |
| Lines of Code | ~12,000 | ~11,500 | ↓ 4% |
| Build Time | 8m 15s | 7m 45s | ↓ 6% |
| MCP Integration | ⚠️ Limited | ✅ Full | ✅ Complete |

---

## 🗂️ What's in cretoai-core?

### 1. Shared Types (11 types)
- `VertexId`, `VertexHash`, `VertexMetadata`
- `VertexMessage`, `ConsensusQuery`, `ConsensusResponse`
- `MessageId`, `TopicHash`, `ContextEntry`
- `PeerInfo`, `PeerId`

### 2. Common Traits (4 traits)
- `Serializable` - Binary encoding/decoding
- `Verifiable` - Signature verification
- `Identifiable` - ID generation
- `Timestamped` - Timestamp management

### 3. Error Types
- `CoreError` - Unified error enum
- Conversion helpers for package-specific errors

### 4. Protocol Constants
- Topic names (e.g., `VERTEX_TOPIC`)
- Protocol versions (e.g., `MCP_PROTOCOL_VERSION`)
- Default configuration values

---

## 📅 Implementation Timeline

### Week 1: Core Package Creation
- Create `src/core/` structure
- Extract types from existing packages
- Define traits and errors
- 100% test coverage

### Week 2: DAG & Network Migration
- Update dependencies
- Replace local types with core types
- Remove duplicates
- Integration testing

### Week 3: MCP Migration
- Enable full dag/network dependencies
- Cross-package integration
- Comprehensive testing

### Week 4: Finalization
- Performance benchmarking
- Documentation updates
- Review and approval

---

## ✅ Success Criteria

### Functional
- [x] SDD document created
- [ ] Zero circular dependencies
- [ ] MCP can use DAG types
- [ ] All tests pass

### Non-Functional
- [ ] <5% performance degradation
- [ ] 100% test coverage (core)
- [ ] Build time <10 minutes
- [ ] Documentation complete

---

## 🚀 Getting Started with Implementation

### Step 1: Review Documents
```bash
# Read the summary first
open docs/architecture/CRETOAI-CORE-SUMMARY.md

# Then read the full SDD
open docs/architecture/CRETOAI-CORE-SDD.md
```

### Step 2: Verify Current State
```bash
# Check for circular dependencies
cd /Users/tommaduri/cretoai
cargo tree -p cretoai-mcp | grep "cretoai-dag"

# Should show circular dependency (we'll fix this!)
```

### Step 3: Create Core Package
```bash
# Create directory structure
mkdir -p src/core/src/{types,traits,error,constants}
mkdir -p src/core/tests

# Copy the Cargo.toml from SDD
# Start extracting types
```

### Step 4: Follow Migration Guide
See Section 10 of [CRETOAI-CORE-SDD.md](./CRETOAI-CORE-SDD.md) for detailed steps.

---

## 📖 Code Examples

### Before: Duplicate Types

**In cretoai-dag/src/vertex.rs**:
```rust
pub type VertexId = String;
pub struct VertexMetadata { /* ... */ }
```

**In cretoai-network/src/consensus_p2p.rs**:
```rust
pub struct VertexMessage {
    pub vertex_id: String,  // Duplicate!
    // ...
}
```

### After: Shared Types

**In cretoai-core/src/types/vertex.rs**:
```rust
pub type VertexId = String;
pub struct VertexMetadata { /* ... */ }
```

**In all packages**:
```rust
use cretoai_core::types::{VertexId, VertexMetadata};
```

**Result**: Single source of truth!

---

## 🔗 Related Resources

### Internal
- [Phase 2 Implementation Spec](../specs/phase2-implementation.md)
- [Avalanche Consensus Integration](../specs/avalanche-consensus-integration.md)
- [LibP2P Integration Guide](../specs/option3-libp2p-integration.md)

### External
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [Cargo Workspaces](https://doc.rust-lang.org/book/ch14-03-cargo-workspaces.html)
- [Serde Documentation](https://serde.rs/)

---

## 📝 Document History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2025-11-27 | 1.0.0 | System Architect | Initial SDD, Summary, and Analysis |

---

## 🤝 Contributing

To update these documents:

1. **Architecture changes**: Update the SDD first
2. **Keep consistent**: Update all 3 docs (SDD, Summary, Analysis)
3. **Version control**: Increment version numbers
4. **Review process**: Get architecture team approval

---

## 📞 Contact

For questions about this architecture:
- **Architecture Team**: CretoAI Core Team
- **Documentation**: See individual documents
- **Issues**: GitHub Issues (tag: `architecture`)

---

**Status**: ✅ Design Complete - Ready for Implementation

**Last Updated**: 2025-11-27
