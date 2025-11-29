# Vigilia DAG Examples

This directory contains end-to-end examples demonstrating the Vigilia DAG consensus module.

## Examples

### 1. Basic DAG (`01_basic_dag.rs`)

Learn the fundamentals of working with DAG graphs:
- Creating vertices with the builder pattern
- Establishing parent-child relationships
- Querying graph structure (children, parents, ancestors)
- Computing topological order
- Finding graph tips (leaves)

**Run:**
```bash
cargo run --example 01_basic_dag
```

**What you'll learn:**
- How to create a genesis vertex
- How to add vertices with single or multiple parents
- How to traverse the DAG structure
- Understanding topological ordering in DAGs

---

### 2. Consensus Workflow (`02_consensus_workflow.rs`)

Understand the QR-Avalanche consensus protocol:
- Configuring consensus parameters (α, β, k)
- Registering network nodes
- Running consensus rounds
- Batch consensus processing
- Byzantine fault tolerance

**Run:**
```bash
cargo run --example 02_consensus_workflow
```

**What you'll learn:**
- How to set up a consensus engine
- Understanding consensus parameters:
  - `k` (sample_size): Number of nodes queried per round
  - `α` (alpha_threshold): Required agreement ratio
  - `β` (beta_threshold): Consecutive successes for finalization
- How consensus achieves safety with Byzantine nodes
- Batch processing for efficiency

**Key Concepts:**
- **Byzantine Fault Tolerance**: System tolerates < 33.3% malicious nodes
- **Probabilistic Safety**: Confidence increases with each successful round
- **Chit Accumulation**: Consecutive successes (β) ensure finalization

---

### 3. Persistent Storage (`03_persistent_storage.rs`)

Master data persistence with RocksDB:
- Creating persistent storage
- Storing and retrieving vertices
- Cross-session data persistence
- LRU caching for performance
- Batch operations for efficiency

**Run:**
```bash
cargo run --example 03_persistent_storage
```

**What you'll learn:**
- How to configure RocksDB storage
- LZ4 compression for space efficiency
- 10k vertex LRU cache for speed
- Batch writes for high throughput
- Data survives process restarts

**Performance Tips:**
- Use batch operations for bulk writes
- LRU cache provides sub-microsecond reads
- Enable compression for large datasets
- Flush before closing for data safety

---

## Running All Examples

To run all examples in sequence:

```bash
cargo run --example 01_basic_dag && \
cargo run --example 02_consensus_workflow && \
cargo run --example 03_persistent_storage
```

## Example Output

Each example produces detailed output explaining what's happening at each step:

```
=== Basic DAG Usage Example ===

✓ Created empty DAG graph
✓ Added genesis vertex
✓ Added vertex-a (child of genesis)
✓ Added vertex-b (child of genesis)
✓ Added vertex-c (merges vertex-a and vertex-b)

=== Graph Structure ===
Total vertices: 4
Genesis children: ["vertex-a", "vertex-b"]
Vertex-C parents: ["vertex-a", "vertex-b"]
...
```

## Architecture Overview

```
┌─────────────────┐
│   Vertex        │  Building block of the DAG
│   - id          │
│   - parents[]   │  References to parent vertices
│   - payload     │  Transaction/data content
│   - metadata    │  Consensus state
└─────────────────┘
         │
         ↓
┌─────────────────┐
│   Graph         │  DAG structure management
│   - vertices    │
│   - edges       │  Parent-child relationships
│   - tips        │  Current leaves (no children)
└─────────────────┘
         │
         ↓
┌─────────────────┐
│ ConsensusEngine │  QR-Avalanche protocol
│   - params      │  α, β, k configuration
│   - network     │  Node registry
│   - states      │  Per-vertex consensus state
└─────────────────┘
         │
         ↓
┌─────────────────┐
│   Storage       │  Persistent RocksDB backend
│   - database    │
│   - cache       │  10k vertex LRU
│   - compression │  LZ4 enabled
└─────────────────┘
```

## Performance Characteristics

Based on benchmark results:

| Operation | Performance |
|-----------|-------------|
| Vertex creation | 175.82 ns |
| Add to graph | 0.61 μs/vertex |
| Graph queries | 62-128 ns |
| Consensus (single) | 17.77 ms |
| Storage (cached) | < 1 μs |
| BLAKE3 hashing | 916 MiB/s |

## Next Steps

After completing these examples, you can:

1. **Integrate with Network Layer**: Add LibP2P for P2P communication
2. **Build Multi-Agent Systems**: Create agent coordination workflows
3. **Add Smart Contracts**: Implement programmable transactions
4. **Scale Horizontally**: Deploy across distributed nodes

## Documentation

- **API Documentation**: `cargo doc --open --package vigilia-dag`
- **Implementation Status**: `docs/IMPLEMENTATION_STATUS.md`
- **Benchmarks**: `cargo bench --package vigilia-dag`

## Questions?

- Check the inline code comments in each example
- Review the unit tests in `src/dag/src/`
- See the main README at project root

---

**Built with quantum-resistant security for the agentic enterprise** 🛡️
