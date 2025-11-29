# Software Design Document: Disaster Recovery & High Availability

**Version**: 1.0.0
**Package**: `@authz-engine/infrastructure`
**Status**: Specification
**Last Updated**: 2025-11-23

---

## 1. Overview

### 1.1 Purpose

This document defines the disaster recovery (DR) and high availability (HA) architecture for the AuthZ Engine, ensuring business continuity and data protection.

### 1.2 Scope

**In Scope:**
- High availability architecture
- Backup and restore procedures
- Failover mechanisms
- Recovery procedures
- Chaos engineering and DR testing

**Out of Scope:**
- Application-level error handling
- Client-side resilience

### 1.3 Recovery Objectives

| Objective | Target | Description |
|-----------|--------|-------------|
| **RTO** (Recovery Time Objective) | <5 minutes | Maximum acceptable downtime |
| **RPO** (Recovery Point Objective) | <1 minute | Maximum acceptable data loss |
| **Availability** | 99.99% | ~52 minutes downtime/year |
| **MTTR** (Mean Time To Recovery) | <3 minutes | Average recovery time |

---

## 2. High Availability Architecture

### 2.1 Multi-Region Deployment

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Global High Availability Architecture                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Global Load Balancer                          │   │
│  │                    (Route53 / CloudFlare)                         │   │
│  └────────────────────────┬─────────────────────────────────────────┘   │
│                           │                                              │
│         ┌─────────────────┼─────────────────┐                           │
│         │                 │                 │                           │
│         ▼                 ▼                 ▼                           │
│  ┌────────────┐    ┌────────────┐    ┌────────────┐                    │
│  │ Region A   │    │ Region B   │    │ Region C   │                    │
│  │ (Primary)  │    │ (Secondary)│    │ (DR)       │                    │
│  │            │    │            │    │            │                    │
│  │ ┌────────┐ │    │ ┌────────┐ │    │ ┌────────┐ │                    │
│  │ │ AuthZ  │ │    │ │ AuthZ  │ │    │ │ AuthZ  │ │                    │
│  │ │ Cluster│ │    │ │ Cluster│ │    │ │ Cluster│ │                    │
│  │ │ (3 AZ) │ │    │ │ (3 AZ) │ │    │ │ (2 AZ) │ │                    │
│  │ └────────┘ │    │ └────────┘ │    │ └────────┘ │                    │
│  │            │    │            │    │            │                    │
│  │ ┌────────┐ │    │ ┌────────┐ │    │ ┌────────┐ │                    │
│  │ │ Redis  │◄├────┼─┤ Redis  │◄├────┼─┤ Redis  │ │                    │
│  │ │(Master)│ │    │ │(Replica)│ │    │ │(Replica)│ │                   │
│  │ └────────┘ │    │ └────────┘ │    │ └────────┘ │                    │
│  │            │    │            │    │            │                    │
│  │ ┌────────┐ │    │ ┌────────┐ │    │ ┌────────┐ │                    │
│  │ │ Audit  │ │───►│ │ Audit  │ │───►│ │ Audit  │ │                    │
│  │ │   DB   │ │    │ │   DB   │ │    │ │   DB   │ │                    │
│  │ └────────┘ │    │ └────────┘ │    │ └────────┘ │                    │
│  └────────────┘    └────────────┘    └────────────┘                    │
│                                                                          │
│  Replication: ────► Async (cross-region)                                │
│               ◄───► Sync (within region)                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Deployment Modes

| Mode | Regions | Use Case | RTO | RPO |
|------|---------|----------|-----|-----|
| Active-Active | 2+ | Global users | <1 min | 0 |
| Active-Passive | 2 | Cost-sensitive | <5 min | <1 min |
| Active-DR | 2 | Compliance | <15 min | <5 min |

### 2.3 Within-Region HA

```yaml
# Kubernetes HA configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authz-server
spec:
  replicas: 3

  # Spread across availability zones
  topologySpreadConstraints:
    - maxSkew: 1
      topologyKey: topology.kubernetes.io/zone
      whenUnsatisfiable: DoNotSchedule
      labelSelector:
        matchLabels:
          app: authz-server

  # Anti-affinity for node spread
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: authz-server
          topologyKey: kubernetes.io/hostname
```

---

## 3. Backup Strategies

### 3.1 Backup Types

| Data Type | Method | Frequency | Retention |
|-----------|--------|-----------|-----------|
| Policies | Git + S3 | Every commit | Forever |
| Audit logs | S3 streaming | Continuous | 7 years |
| Configuration | K8s etcd backup | Hourly | 30 days |
| Redis cache | RDB snapshots | Hourly | 7 days |
| Decision store | Postgres backup | Hourly | 90 days |

### 3.2 Policy Backup

```typescript
interface PolicyBackupConfig {
  storage: {
    type: 's3' | 'gcs' | 'azure-blob';
    bucket: string;
    prefix: string;
    region: string;
  };
  encryption: {
    enabled: true;
    kmsKeyId: string;
  };
  versioning: {
    enabled: true;
    maxVersions: 100;
  };
}

class PolicyBackupService {
  async backup(policies: Policy[]): Promise<BackupResult> {
    const timestamp = new Date().toISOString();
    const backupId = `policy-backup-${timestamp}`;

    // Serialize policies
    const data = JSON.stringify(policies, null, 2);

    // Encrypt
    const encrypted = await this.encrypt(data);

    // Upload to S3
    await this.s3.putObject({
      Bucket: this.config.storage.bucket,
      Key: `${this.config.storage.prefix}/${backupId}.json.enc`,
      Body: encrypted,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.config.encryption.kmsKeyId,
      Metadata: {
        'backup-id': backupId,
        'policy-count': String(policies.length),
        'timestamp': timestamp,
      },
    });

    return {
      backupId,
      policyCount: policies.length,
      size: encrypted.length,
      timestamp,
    };
  }

  async restore(backupId: string): Promise<Policy[]> {
    // Download from S3
    const response = await this.s3.getObject({
      Bucket: this.config.storage.bucket,
      Key: `${this.config.storage.prefix}/${backupId}.json.enc`,
    });

    // Decrypt
    const data = await this.decrypt(response.Body);

    // Parse and validate
    const policies = JSON.parse(data);
    await this.validatePolicies(policies);

    return policies;
  }
}
```

### 3.3 Audit Log Backup

```typescript
interface AuditBackupConfig {
  streaming: {
    enabled: true;
    batchSize: 1000;
    flushIntervalMs: 5000;
  };
  storage: {
    hot: {
      type: 'elasticsearch';
      retention: '30d';
    };
    warm: {
      type: 's3';
      retention: '1y';
      storageClass: 'STANDARD_IA';
    };
    cold: {
      type: 's3';
      retention: '7y';
      storageClass: 'GLACIER';
    };
  };
}

class AuditBackupService {
  private buffer: AuditEvent[] = [];

  async addEvent(event: AuditEvent): Promise<void> {
    this.buffer.push(event);

    if (this.buffer.length >= this.config.streaming.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    const events = this.buffer.splice(0, this.buffer.length);

    // Write to hot storage (Elasticsearch)
    await this.elasticsearch.bulk({
      body: events.flatMap(event => [
        { index: { _index: `audit-${event.date}` } },
        event,
      ]),
    });

    // Stream to warm storage (S3)
    await this.streamToS3(events);
  }

  private async streamToS3(events: AuditEvent[]): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const key = `audit/${date}/${Date.now()}.jsonl.gz`;

    const compressed = await this.compress(
      events.map(e => JSON.stringify(e)).join('\n')
    );

    await this.s3.putObject({
      Bucket: this.config.storage.warm.bucket,
      Key: key,
      Body: compressed,
      StorageClass: 'STANDARD_IA',
    });
  }
}
```

### 3.4 Backup Verification

```typescript
class BackupVerificationService {
  async verifyBackup(backupId: string): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];

    // 1. Check backup exists
    const exists = await this.checkBackupExists(backupId);
    checks.push({ name: 'exists', passed: exists });

    // 2. Verify checksum
    const checksumValid = await this.verifyChecksum(backupId);
    checks.push({ name: 'checksum', passed: checksumValid });

    // 3. Test restore to staging
    const restoreTest = await this.testRestore(backupId);
    checks.push({ name: 'restore', passed: restoreTest.success });

    // 4. Validate policy count
    const countValid = await this.validatePolicyCount(backupId);
    checks.push({ name: 'policy_count', passed: countValid });

    return {
      backupId,
      passed: checks.every(c => c.passed),
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 4. Recovery Procedures

### 4.1 Automated Failover

```typescript
interface FailoverConfig {
  healthCheck: {
    interval: 5000;        // 5 seconds
    timeout: 3000;         // 3 seconds
    threshold: 3;          // 3 consecutive failures
  };
  failover: {
    mode: 'automatic' | 'manual';
    cooldownMs: 300000;    // 5 minutes between failovers
    notifyChannels: ['pagerduty', 'slack'];
  };
}

class FailoverController {
  private primaryHealthy = true;
  private failureCount = 0;
  private lastFailover?: Date;

  async checkHealth(): Promise<HealthStatus> {
    try {
      const response = await fetch(
        `${this.primaryEndpoint}/health/ready`,
        { timeout: this.config.healthCheck.timeout }
      );

      if (response.ok) {
        this.failureCount = 0;
        this.primaryHealthy = true;
        return { healthy: true, region: 'primary' };
      }
    } catch (error) {
      this.failureCount++;
    }

    // Check if threshold exceeded
    if (this.failureCount >= this.config.healthCheck.threshold) {
      await this.initiateFailover();
    }

    return { healthy: false, region: 'primary', failureCount: this.failureCount };
  }

  async initiateFailover(): Promise<FailoverResult> {
    // Check cooldown
    if (this.lastFailover) {
      const elapsed = Date.now() - this.lastFailover.getTime();
      if (elapsed < this.config.failover.cooldownMs) {
        throw new Error('Failover cooldown active');
      }
    }

    // Notify
    await this.notify('Initiating failover to secondary region');

    // Update DNS
    await this.updateDNS('secondary');

    // Verify secondary is healthy
    const secondaryHealth = await this.checkSecondaryHealth();
    if (!secondaryHealth.healthy) {
      throw new Error('Secondary region not healthy');
    }

    this.lastFailover = new Date();
    this.primaryHealthy = false;

    await this.notify('Failover complete');

    return {
      success: true,
      previousRegion: 'primary',
      newRegion: 'secondary',
      timestamp: this.lastFailover,
    };
  }

  async initiateFailback(): Promise<FailoverResult> {
    // Verify primary is recovered
    const primaryHealth = await this.checkPrimaryHealth();
    if (!primaryHealth.healthy) {
      throw new Error('Primary region not healthy');
    }

    // Sync any new data from secondary
    await this.syncData('secondary', 'primary');

    // Update DNS
    await this.updateDNS('primary');

    this.primaryHealthy = true;

    return {
      success: true,
      previousRegion: 'secondary',
      newRegion: 'primary',
      timestamp: new Date(),
    };
  }
}
```

### 4.2 Manual Recovery Runbook

```markdown
# AuthZ Engine Disaster Recovery Runbook

## 1. Incident Detection
- [ ] Alert received from monitoring
- [ ] Verify outage scope (single node, AZ, region)
- [ ] Page on-call engineer

## 2. Initial Assessment (5 minutes)
- [ ] Check primary region health: `kubectl get pods -n authz-engine`
- [ ] Check Redis cluster status: `redis-cli cluster info`
- [ ] Check recent deployments: `helm history authz-engine`
- [ ] Review error logs: `kubectl logs -l app=authz-server --tail=1000`

## 3. Decision Tree

### If: Single pod failure
- Action: Let Kubernetes reschedule (automatic)
- Verify: `kubectl get pods -w`

### If: Node failure
- Action: Drain node, let pods reschedule
- Command: `kubectl drain node-name --ignore-daemonsets`

### If: AZ failure
- Action: Traffic automatically shifts to other AZs
- Verify: `kubectl get pods -o wide | grep -v <failed-az>`

### If: Region failure
- Action: Initiate regional failover
- See: Section 4

## 4. Regional Failover (Target: <5 minutes)

### 4.1 Verify Secondary Ready
```bash
# Check secondary region
kubectl --context secondary get pods -n authz-engine

# Check Redis replication lag
redis-cli -h redis-secondary info replication
```

### 4.2 Update DNS
```bash
# Route53 failover
aws route53 change-resource-record-sets \
  --hosted-zone-id $ZONE_ID \
  --change-batch file://failover-to-secondary.json

# Or CloudFlare
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -d '{"content": "secondary-region-ip"}'
```

### 4.3 Verify Failover
```bash
# Test endpoint
curl https://authz.example.com/health/ready

# Check metrics
curl https://authz.example.com/metrics | grep authz_check_total
```

## 5. Data Recovery

### 5.1 Restore Policies from Backup
```bash
# List available backups
aws s3 ls s3://authz-backups/policies/ --recursive | tail -10

# Download and restore
./scripts/restore-policies.sh backup-2024-01-15T10:00:00Z
```

### 5.2 Restore Audit Logs
```bash
# Restore from S3 to Elasticsearch
./scripts/restore-audit-logs.sh --from 2024-01-14 --to 2024-01-15
```

## 6. Post-Incident
- [ ] Document incident timeline
- [ ] Update runbook if needed
- [ ] Schedule post-mortem
- [ ] Plan failback when primary recovered
```

---

## 5. Failure Scenarios

### 5.1 Failure Matrix

| Scenario | Impact | Detection | Recovery | RTO |
|----------|--------|-----------|----------|-----|
| Single pod crash | None (HA) | K8s | Automatic | <30s |
| Node failure | Minimal | K8s | Automatic | <2m |
| AZ failure | Degraded | Monitoring | Automatic | <2m |
| Region failure | Degraded | Health check | Failover | <5m |
| Redis failure | Cache miss | Sentinel | Automatic | <30s |
| DB corruption | Data loss | Checksum | Restore | <15m |
| Network partition | Split-brain | Monitoring | Manual | <10m |

### 5.2 Split-Brain Prevention

```typescript
class SplitBrainProtection {
  private quorum: QuorumManager;

  async canServeRequests(): Promise<boolean> {
    // Require quorum to serve requests
    const hasQuorum = await this.quorum.hasQuorum();

    if (!hasQuorum) {
      // Demote to read-only or reject requests
      return false;
    }

    return true;
  }

  async resolvePartition(): Promise<void> {
    // Wait for network to heal
    // Use fencing to prevent split-brain writes
    // Merge any divergent data using CRDTs or last-write-wins
  }
}
```

---

## 6. Data Replication

### 6.1 Replication Configuration

```yaml
# Redis replication
replication:
  mode: async
  minReplicas: 2
  maxLag: 1000  # 1 second

# PostgreSQL replication (audit DB)
postgresql:
  replication:
    mode: synchronous  # Within region
    numSynchronousReplicas: 1
  streaming:
    mode: async  # Cross region
    maxLagMB: 100
```

### 6.2 Conflict Resolution

```typescript
enum ConflictStrategy {
  LAST_WRITE_WINS = 'lww',
  FIRST_WRITE_WINS = 'fww',
  MERGE = 'merge',
  MANUAL = 'manual',
}

interface ConflictResolver {
  resolve<T>(local: T, remote: T, metadata: ConflictMetadata): T;
}

class LastWriteWinsResolver implements ConflictResolver {
  resolve<T>(local: T, remote: T, metadata: ConflictMetadata): T {
    return metadata.localTimestamp > metadata.remoteTimestamp ? local : remote;
  }
}
```

---

## 7. Chaos Engineering

### 7.1 Chaos Experiments

```yaml
# Chaos Mesh - Pod failure
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: authz-pod-kill
spec:
  action: pod-kill
  mode: one
  selector:
    namespaces:
      - authz-engine
    labelSelectors:
      app: authz-server
  scheduler:
    cron: "@every 24h"  # Daily chaos test
---
# Network partition
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: authz-network-partition
spec:
  action: partition
  mode: all
  selector:
    namespaces:
      - authz-engine
  direction: both
  duration: "30s"
---
# Latency injection
apiVersion: chaos-mesh.org/v1alpha1
kind: NetworkChaos
metadata:
  name: authz-latency
spec:
  action: delay
  mode: all
  selector:
    namespaces:
      - authz-engine
  delay:
    latency: "100ms"
    jitter: "50ms"
  duration: "60s"
```

### 7.2 DR Drill Schedule

| Drill | Frequency | Scope | Duration |
|-------|-----------|-------|----------|
| Pod failure | Weekly | Single pod | 5 min |
| Node failure | Monthly | Single node | 15 min |
| AZ failure | Quarterly | Full AZ | 30 min |
| Region failover | Semi-annually | Full region | 2 hours |
| Full restore | Annually | All data | 4 hours |

---

## 8. Monitoring & Alerting

### 8.1 Health Indicators

```typescript
interface HealthIndicators {
  // Primary indicators
  primaryRegionHealthy: boolean;
  secondaryRegionHealthy: boolean;
  replicationLagMs: number;

  // Backup indicators
  lastBackupTime: Date;
  backupVerificationPassed: boolean;

  // Capacity indicators
  availableCapacity: number;  // Percentage

  // SLA indicators
  currentAvailability: number;  // Percentage
  mttr: number;  // Minutes
}

const healthCheckEndpoint = {
  '/health/live': 'Basic liveness',
  '/health/ready': 'Full readiness including dependencies',
  '/health/dr': 'DR-specific health including replication status',
};
```

### 8.2 Alert Rules

```yaml
# PrometheusRule for DR alerts
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: authz-dr-alerts
spec:
  groups:
    - name: disaster-recovery
      rules:
        - alert: ReplicationLagHigh
          expr: authz_replication_lag_seconds > 60
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Replication lag is high"

        - alert: BackupMissing
          expr: time() - authz_last_backup_timestamp > 7200
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "No backup in last 2 hours"

        - alert: SecondaryRegionUnhealthy
          expr: authz_secondary_region_healthy == 0
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Secondary region is unhealthy"

        - alert: AvailabilityBelowSLA
          expr: authz_availability_30d < 0.9999
          for: 1h
          labels:
            severity: warning
          annotations:
            summary: "Availability below 99.99% SLA"
```

---

## 9. Compliance

### 9.1 Retention Requirements

| Data Type | HIPAA | PCI-DSS | SOC 2 | GDPR |
|-----------|-------|---------|-------|------|
| Audit logs | 6 years | 1 year | 1 year | Varies |
| Policies | N/A | N/A | 1 year | N/A |
| Backups | 6 years | 1 year | 1 year | Varies |

### 9.2 Geographic Restrictions

```typescript
interface GeoRestriction {
  dataResidency: {
    eu: ['eu-west-1', 'eu-central-1'];
    us: ['us-east-1', 'us-west-2'];
    apac: ['ap-southeast-1', 'ap-northeast-1'];
  };

  // Ensure DR region respects data residency
  allowedDRRegions: {
    'eu-west-1': ['eu-central-1', 'eu-west-2'];  // EU stays in EU
    'us-east-1': ['us-west-2', 'us-east-2'];     // US stays in US
  };
}
```

---

## 10. Testing Strategy

### 10.1 DR Tests

| Test | Type | Frequency | Pass Criteria |
|------|------|-----------|---------------|
| Backup restore | Automated | Daily | Data integrity verified |
| Failover | Manual | Monthly | RTO < 5 min |
| Full DR | Manual | Quarterly | All systems recovered |

### 10.2 Test Automation

```typescript
describe('Disaster Recovery', () => {
  it('should failover within RTO', async () => {
    // Simulate primary failure
    await simulatePrimaryFailure();

    const startTime = Date.now();

    // Wait for automatic failover
    await waitForFailover();

    const failoverTime = Date.now() - startTime;

    // Verify RTO
    expect(failoverTime).toBeLessThan(5 * 60 * 1000); // 5 minutes

    // Verify service is healthy
    const health = await checkHealth('secondary');
    expect(health.status).toBe('healthy');
  });

  it('should restore from backup within RPO', async () => {
    const latestBackup = await getLatestBackup();
    const backupAge = Date.now() - latestBackup.timestamp;

    // Verify RPO
    expect(backupAge).toBeLessThan(60 * 1000); // 1 minute

    // Test restore
    const restored = await restoreFromBackup(latestBackup.id);
    expect(restored.success).toBe(true);
  });
});
```

---

## 11. Dependencies

| Dependency | Purpose | HA Configuration |
|------------|---------|------------------|
| Redis | Caching | Sentinel/Cluster |
| PostgreSQL | Audit logs | Streaming replication |
| S3/GCS | Backups | Cross-region replication |
| Route53/CloudFlare | DNS failover | Health check + failover |

---

*Last Updated: 2025-11-23*
