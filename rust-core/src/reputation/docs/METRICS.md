# Prometheus Metrics for Reputation System

Comprehensive metrics collection for monitoring and observability across the reputation, stake, and reward systems.

## Overview

The reputation system exports **42 Prometheus metrics** organized into three categories:
- **15 Reputation Metrics**: Track node behavior, violations, and scores
- **13 Stake Metrics**: Monitor deposits, slashing, and withdrawals
- **14 Reward Metrics**: Measure reward distribution and efficiency

## Metrics Endpoint

Metrics are exposed at the node's Prometheus endpoint:
```
http://localhost:9090/metrics
```

Configure in `config/node.toml`:
```toml
prometheus_enabled = true
prometheus_port = 9090
```

## Reputation Metrics

### Gauges

#### `cretoai_reputation_score{node_id}`
Current reputation score per node (0.0-1.0)
- **Type**: Gauge
- **Labels**: `node_id` - UUID of the node
- **Range**: 0.0 (worst) to 1.0 (perfect)

#### `cretoai_reputation_mean`
Mean reputation score across all nodes
- **Type**: Gauge
- **Range**: 0.0 to 1.0

#### `cretoai_reputation_median`
Median reputation score across all nodes
- **Type**: Gauge
- **Range**: 0.0 to 1.0

#### `cretoai_reputation_nodes_above_threshold`
Number of nodes above reliability threshold (0.2)
- **Type**: IntGauge
- **Interpretation**: Healthy nodes in the network

#### `cretoai_reputation_nodes_below_threshold`
Number of nodes below reliability threshold
- **Type**: IntGauge
- **Interpretation**: Potentially problematic nodes

#### `cretoai_reputation_total_nodes`
Total number of tracked nodes
- **Type**: IntGauge

#### `cretoai_reputation_highest_score`
Highest reputation score in the network
- **Type**: Gauge

#### `cretoai_reputation_lowest_score`
Lowest reputation score in the network
- **Type**: Gauge

### Counters

#### `cretoai_reputation_violations_total{node_id, violation_type}`
Total violations detected per node and type
- **Type**: IntCounter
- **Labels**:
  - `node_id` - UUID of the violating node
  - `violation_type` - One of: `Equivocation`, `ByzantineBehavior`, `InvalidSignature`, `ProtocolViolation`, `TimeoutViolation`

#### `cretoai_reputation_events_total{node_id, event_type}`
Total reputation events per node and type
- **Type**: IntCounter
- **Labels**:
  - `node_id` - UUID of the node
  - `event_type` - One of: `VertexFinalized`, `ConsensusParticipation`, `VertexPropagation`, `ByzantineDetection`

### Histograms

#### `cretoai_reputation_decay_seconds{node_id}`
Distribution of reputation decay times in seconds
- **Type**: Histogram
- **Buckets**: `[3600, 86400, 604800, 2592000, 7776000]` (1 hour to 90 days)
- **Labels**: `node_id`

#### `cretoai_reputation_score_distribution`
Overall distribution of reputation scores
- **Type**: Histogram
- **Buckets**: `[0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]`

## Stake Metrics

### Gauges

#### `cretoai_stake_total`
Total amount staked across all nodes
- **Type**: IntGauge
- **Unit**: Smallest currency unit (e.g., satoshis)

#### `cretoai_stake_per_node{node_id}`
Stake amount per node
- **Type**: IntGauge
- **Labels**: `node_id`

#### `cretoai_stake_average`
Average stake per node
- **Type**: IntGauge

#### `cretoai_stake_active_deposits{node_id}`
Number of active deposits per node
- **Type**: IntGauge
- **Labels**: `node_id`

#### `cretoai_stake_pending_withdrawals`
Number of pending withdrawal requests
- **Type**: IntGauge

#### `cretoai_stake_unbonding_total`
Total amount in unbonding state
- **Type**: IntGauge

### Counters

#### `cretoai_stake_deposits_total`
Total number of deposits made
- **Type**: IntCounter

#### `cretoai_stake_slashed_total{violation_type}`
Total amount slashed by violation type
- **Type**: IntCounter
- **Labels**: `violation_type`

#### `cretoai_stake_withdrawals_total`
Total number of withdrawals completed
- **Type**: IntCounter

### Histograms

#### `cretoai_stake_deposit_amount_histogram`
Distribution of stake deposit amounts
- **Type**: Histogram
- **Buckets**: `[1000, 5000, 10000, 50000, 100000, 500000, 1000000]`

#### `cretoai_stake_slashing_amount_histogram{violation_type}`
Distribution of slashing amounts by violation type
- **Type**: Histogram
- **Labels**: `violation_type`
- **Buckets**: Same as deposit amounts

#### `cretoai_stake_withdrawal_amount_histogram`
Distribution of withdrawal amounts
- **Type**: Histogram
- **Buckets**: Same as deposit amounts

## Reward Metrics

### Gauges

#### `cretoai_rewards_pending_total`
Total pending rewards across all nodes
- **Type**: IntGauge

#### `cretoai_rewards_unique_recipients`
Number of unique reward recipients
- **Type**: IntGauge

#### `cretoai_rewards_distribution_efficiency`
Distribution efficiency ratio (distributed / total)
- **Type**: Gauge
- **Range**: 0.0 to 1.0
- **Interpretation**: Higher is better (more rewards distributed)

#### `cretoai_rewards_pending_per_node{node_id}`
Pending rewards per node
- **Type**: IntGauge
- **Labels**: `node_id`

### Counters

#### `cretoai_rewards_distributed_total_value`
Total value of distributed rewards
- **Type**: IntCounter

#### `cretoai_rewards_distributed_count{reward_type}`
Number of rewards distributed by type
- **Type**: IntCounter
- **Labels**: `reward_type` - One of: `BlockProduction`, `TransactionFees`, `UptimeBonus`

#### `cretoai_rewards_uptime_bonuses_total`
Number of uptime bonuses awarded
- **Type**: IntCounter

#### `cretoai_rewards_total_per_node{node_id}`
Total rewards earned per node
- **Type**: IntCounter
- **Labels**: `node_id`

#### `cretoai_rewards_failed_total{reason}`
Failed reward distributions by reason
- **Type**: IntCounter
- **Labels**: `reason` - Failure reason

### Histograms

#### `cretoai_rewards_distribution_amount{reward_type}`
Distribution of reward amounts by type
- **Type**: Histogram
- **Labels**: `reward_type`
- **Buckets**: `[10, 50, 100, 500, 1000, 5000, 10000]`

## Usage Examples

### Initialize Metrics

```rust
use cretoai_reputation::{register_metrics, ReputationMetrics};

// Initialize metrics once during node startup
let metrics = register_metrics()?;
```

### Update Reputation Metrics

```rust
use cretoai_reputation::{
    update_reputation_metrics, update_node_reputation_score,
    record_reputation_event, record_reputation_violation,
};

// Update per-node score
update_node_reputation_score(&metrics, &node_id.to_string(), 0.85);

// Record events
record_reputation_event(&metrics, &node_id.to_string(), "VertexFinalized");
record_reputation_violation(&metrics, &node_id.to_string(), "TimeoutViolation");

// Update aggregate statistics
let stats = tracker.get_statistics();
update_reputation_metrics(
    &metrics,
    stats.total_nodes,
    stats.reliable_nodes,
    stats.unreliable_nodes,
    stats.average_score,
    stats.highest_score,
    stats.lowest_score,
);
```

### Update Stake Metrics

```rust
use cretoai_reputation::{
    record_stake_deposit, record_stake_slashing,
    update_node_stake, update_stake_metrics,
};

// Record deposit
record_stake_deposit(&metrics, 10000);
update_node_stake(&metrics, &node_id.to_string(), 10000);

// Record slashing
record_stake_slashing(&metrics, "Equivocation", 3000);

// Update aggregate statistics
let stats = stake_manager.get_statistics();
update_stake_metrics(
    &metrics,
    stats.total_staked,
    stats.average_stake,
    stats.total_withdrawals,
    unbonding_amount,
);
```

### Update Reward Metrics

```rust
use cretoai_reputation::{
    record_reward_distribution, record_uptime_bonus,
    update_reward_metrics,
};

// Record reward distribution
record_reward_distribution(&metrics, "BlockProduction", 1000);
record_uptime_bonus(&metrics);

// Update aggregate statistics
let stats = reward_distributor.get_statistics();
update_reward_metrics(
    &metrics,
    stats.total_pending,
    stats.unique_recipients,
    stats.distribution_efficiency,
);
```

## Prometheus Queries

### Reputation Queries

```promql
# Average reputation over time
cretoai_reputation_mean

# Nodes below threshold
cretoai_reputation_nodes_below_threshold

# Violation rate by type (5-minute rate)
rate(cretoai_reputation_violations_total[5m])

# Top 5 nodes by reputation
topk(5, cretoai_reputation_score)
```

### Stake Queries

```promql
# Total network stake
cretoai_stake_total

# Slashing rate by violation type (1-hour rate)
rate(cretoai_stake_slashed_total[1h])

# Average stake per node
cretoai_stake_average

# Nodes with largest stakes
topk(10, cretoai_stake_per_node)
```

### Reward Queries

```promql
# Pending rewards
cretoai_rewards_pending_total

# Reward distribution rate (1-hour rate)
rate(cretoai_rewards_distributed_count[1h])

# Distribution efficiency
cretoai_rewards_distribution_efficiency

# Rewards by type
sum by (reward_type) (cretoai_rewards_distributed_count)
```

## Grafana Dashboard

A sample Grafana dashboard configuration is available at:
```
config/grafana/reputation-dashboard.json
```

Import this dashboard to visualize:
- Real-time reputation scores
- Violation and slashing events
- Stake distribution
- Reward distribution efficiency
- Network health metrics

## Alert Rules

Sample Prometheus alert rules (`config/prometheus/alerts.yml`):

```yaml
groups:
  - name: reputation_alerts
    rules:
      - alert: HighViolationRate
        expr: rate(cretoai_reputation_violations_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High violation rate detected"

      - alert: LowReputationNodes
        expr: cretoai_reputation_nodes_below_threshold > 5
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "Too many unreliable nodes"

      - alert: HighSlashingRate
        expr: rate(cretoai_stake_slashed_total[1h]) > 1000
        for: 30m
        labels:
          severity: warning
        annotations:
          summary: "High slashing rate detected"

      - alert: LowDistributionEfficiency
        expr: cretoai_rewards_distribution_efficiency < 0.8
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Reward distribution efficiency below 80%"
```

## Performance Considerations

- **Memory**: Each metric with labels consumes memory. With 1000 nodes, expect ~50MB overhead.
- **Cardinality**: Node IDs create high cardinality. Monitor Prometheus memory usage.
- **Scrape Interval**: Recommended 15-30 seconds for production.
- **Retention**: Keep 30 days of data for trend analysis.

## Testing

Run metrics integration tests:
```bash
cargo test -p cretoai-reputation --test metrics_integration_test
```

Run example:
```bash
cargo run -p cretoai-reputation --example metrics_integration
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Node Metrics Server             │
│         http://localhost:9090           │
└────────────────┬────────────────────────┘
                 │
                 │ Scrape
                 ▼
┌─────────────────────────────────────────┐
│       Prometheus Registry               │
│  (42 metrics registered at startup)     │
└─────────────┬───────────────────────────┘
              │
              │ Update calls
              ▼
┌─────────────────────────────────────────┐
│     ReputationMetrics Collection        │
│  - Reputation: 15 metrics               │
│  - Stake: 13 metrics                    │
│  - Rewards: 14 metrics                  │
└─┬───────────┬───────────────────┬───────┘
  │           │                   │
  ▼           ▼                   ▼
┌─────┐   ┌──────┐           ┌─────────┐
│Rep. │   │Stake │           │Reward   │
│Track│   │Mgr.  │           │Distrib. │
└─────┘   └──────┘           └─────────┘
```

## References

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Dashboard Guide](https://grafana.com/docs/grafana/latest/dashboards/)
- [CretoAI Reputation System](../README.md)
