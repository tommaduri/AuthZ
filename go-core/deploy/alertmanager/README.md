# Alertmanager Configuration for AuthZ Engine

This directory contains Alertmanager configuration for the AuthZ Engine observability suite (Phase 4.5).

## Overview

Alertmanager handles routing, grouping, and notification of alerts from Prometheus. This configuration provides:

- **Severity-based routing** - Critical alerts go to PagerDuty, warnings to Slack
- **Component-specific channels** - Separate notifications for authorization, embedding, and vector store
- **Intelligent grouping** - Related alerts grouped together to reduce noise
- **Inhibition rules** - Suppress lower severity alerts when higher severity fires
- **Multiple receiver types** - PagerDuty, Slack, and email notifications

## File Structure

```
alertmanager/
├── alertmanager.yml           # Main configuration file
├── receivers-pagerduty.yml    # PagerDuty integration examples
├── receivers-slack.yml        # Slack integration examples
└── README.md                  # This file
```

## Quick Start

### 1. Installation

#### Using Docker
```bash
docker run -d \
  --name alertmanager \
  -p 9093:9093 \
  -v /path/to/alertmanager.yml:/etc/alertmanager/alertmanager.yml \
  prom/alertmanager:latest
```

#### Using Binary
```bash
# Download
wget https://github.com/prometheus/alertmanager/releases/download/v0.26.0/alertmanager-0.26.0.linux-amd64.tar.gz
tar xvfz alertmanager-*.tar.gz
cd alertmanager-*

# Run
./alertmanager --config.file=alertmanager.yml
```

#### Using Kubernetes
```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install alertmanager prometheus-community/alertmanager \
  --set config.global.resolve_timeout=5m \
  --set-file config.files.alertmanager\\.yml=/path/to/alertmanager.yml
```

### 2. Configuration

#### Replace Placeholders

Edit `alertmanager.yml` and replace these placeholders:

**SMTP Configuration:**
```yaml
smtp_smarthost: 'smtp.gmail.com:587'
smtp_from: 'alertmanager@authz-engine.io'
smtp_auth_username: 'your-email@gmail.com'
smtp_auth_password: 'your-app-password'
```

**PagerDuty:**
```yaml
service_key: 'abc123def456'  # From PagerDuty integration
```

**Slack:**
```yaml
api_url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX'
```

#### Validate Configuration

```bash
# Check configuration syntax
amtool check-config alertmanager.yml

# Test routing
amtool config routes test \
  --config.file=alertmanager.yml \
  --tree \
  alertname="HighErrorRate" severity="critical" component="authorization"
```

### 3. Connect to Prometheus

Update your Prometheus configuration (`prometheus.yml`):

```yaml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']
```

Restart Prometheus to apply changes.

## Configuration Details

### Routing Structure

```
root
├── critical alerts → PagerDuty (5s wait)
│   ├── authorization → pagerduty-critical
│   ├── embedding → pagerduty-critical
│   └── vector_store → pagerduty-critical
├── warning alerts → Slack (30s wait)
│   ├── authorization → slack-authz-warnings
│   ├── embedding → slack-embedding-warnings
│   └── vector_store → slack-vector-warnings
├── info alerts → Slack (5m wait)
└── default → email
```

### Grouping Behavior

Alerts are grouped by:
- `alertname` - Same alert type
- `cluster` - Same cluster/environment
- `service` - Same service
- `component` - Same component (authorization, embedding, vector_store)

**Timing:**
- `group_wait: 10s` - Wait for more alerts before sending first notification
- `group_interval: 5m` - Wait before sending notifications about new alerts in group
- `repeat_interval: 4h` - Resend notifications for still-firing alerts

### Inhibition Rules

Lower severity alerts are suppressed when higher severity fires:

```
CRITICAL → suppresses → WARNING & INFO
WARNING → suppresses → INFO
```

**Examples:**
- If `AuthorizationServiceDown` (critical) fires, `LowCacheHitRate` (warning) is suppressed
- If `HighErrorRate` (critical) fires, `HighAuthorizationLatency` (warning) is suppressed

## Receiver Setup

### PagerDuty Integration

#### 1. Create Integration
1. Go to **Services** → **Service Directory** → **New Service**
2. Choose **Integrate via Event API V2**
3. Copy the **Integration Key**

#### 2. Configure Alertmanager
Replace `<PAGERDUTY_SERVICE_KEY>` in `alertmanager.yml`:

```yaml
pagerduty_configs:
  - service_key: 'YOUR_INTEGRATION_KEY'
```

#### 3. Severity Mapping
- `critical` → P1 (high urgency, phone/SMS)
- `warning` → P2 (low urgency, push/email)

See `receivers-pagerduty.yml` for detailed examples.

### Slack Integration

#### 1. Create Incoming Webhook
1. Go to https://api.slack.com/apps
2. Create new app or select existing
3. Add **Incoming Webhooks** feature
4. Create webhook for each channel

#### 2. Create Channels
```
#authz-alerts-critical      - Critical alerts
#authz-alerts-warnings      - Warning alerts
#authz-alerts-info          - Info alerts
#authz-alerts-authorization - Authorization component
#authz-alerts-embedding     - Embedding pipeline
#authz-alerts-vector        - Vector store
#authz-policy-errors        - Policy errors
#authz-platform-team        - Team notifications
```

#### 3. Configure Alertmanager
Replace `<SLACK_WEBHOOK_URL>` in `alertmanager.yml`:

```yaml
slack_configs:
  - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
    channel: '#authz-alerts-warnings'
```

See `receivers-slack.yml` for detailed examples.

### Email Notifications

#### 1. SMTP Configuration

**Gmail Example:**
```yaml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alertmanager@yourdomain.com'
  smtp_auth_username: 'your-email@gmail.com'
  smtp_auth_password: 'your-app-password'  # Use app password, not regular password
  smtp_require_tls: true
```

**Office 365 Example:**
```yaml
global:
  smtp_smarthost: 'smtp.office365.com:587'
  smtp_from: 'alertmanager@yourdomain.com'
  smtp_auth_username: 'your-email@yourdomain.com'
  smtp_auth_password: 'your-password'
  smtp_require_tls: true
```

**Custom SMTP Example:**
```yaml
global:
  smtp_smarthost: 'mail.yourdomain.com:587'
  smtp_from: 'alertmanager@yourdomain.com'
  smtp_auth_username: 'smtp-user'
  smtp_auth_password: 'smtp-password'
  smtp_require_tls: true
```

#### 2. Email Receiver
```yaml
receivers:
  - name: 'default-email'
    email_configs:
      - to: 'authz-oncall@example.com'
        headers:
          Subject: '[AuthZ Engine] Alert: {{ .GroupLabels.alertname }}'
```

## Testing

### 1. Send Test Alert

Using `amtool`:
```bash
amtool alert add \
  alertname="HighErrorRate" \
  severity="critical" \
  component="authorization" \
  cluster="production" \
  team="authz-platform" \
  --alertmanager.url=http://localhost:9093
```

Using `curl`:
```bash
curl -X POST http://localhost:9093/api/v1/alerts -d '[
  {
    "labels": {
      "alertname": "HighErrorRate",
      "severity": "critical",
      "component": "authorization"
    },
    "annotations": {
      "summary": "Test alert",
      "description": "This is a test alert",
      "runbook_url": "https://docs.authz-engine.io/runbooks/test"
    }
  }
]'
```

### 2. Check Alert Status

```bash
# List all alerts
amtool alert --alertmanager.url=http://localhost:9093

# Query specific alert
amtool alert query alertname="HighErrorRate" --alertmanager.url=http://localhost:9093
```

### 3. Silence Alerts

```bash
# Create silence
amtool silence add \
  alertname="HighErrorRate" \
  --duration=2h \
  --comment="Maintenance window" \
  --alertmanager.url=http://localhost:9093

# List silences
amtool silence --alertmanager.url=http://localhost:9093

# Expire silence
amtool silence expire <SILENCE_ID> --alertmanager.url=http://localhost:9093
```

## Monitoring Alertmanager

### Metrics
Alertmanager exposes metrics at `http://localhost:9093/metrics`:

- `alertmanager_alerts` - Current number of alerts
- `alertmanager_alerts_received_total` - Total alerts received
- `alertmanager_notifications_total` - Notifications sent by receiver
- `alertmanager_notifications_failed_total` - Failed notifications

### Health Check
```bash
curl http://localhost:9093/-/healthy
curl http://localhost:9093/-/ready
```

### Web UI
Access the Alertmanager UI at: http://localhost:9093

Features:
- View active alerts
- View silences
- Create new silences
- View alert groups
- View configuration

## Troubleshooting

### Alerts Not Being Sent

1. **Check Prometheus connection:**
   ```bash
   curl http://prometheus:9090/api/v1/status/config | jq '.data.yaml' | grep -A5 'alertmanagers'
   ```

2. **Check alert rules firing:**
   ```bash
   curl http://prometheus:9090/api/v1/rules | jq '.data.groups[].rules[] | select(.state=="firing")'
   ```

3. **Check Alertmanager logs:**
   ```bash
   docker logs alertmanager
   ```

4. **Verify configuration:**
   ```bash
   amtool check-config alertmanager.yml
   ```

### PagerDuty Not Receiving Alerts

1. **Verify service key** is correct
2. **Check PagerDuty integration status** in PagerDuty UI
3. **Review Alertmanager logs** for PagerDuty API errors
4. **Test API directly:**
   ```bash
   curl -X POST https://events.pagerduty.com/v2/enqueue \
     -H 'Content-Type: application/json' \
     -d '{
       "routing_key": "YOUR_KEY",
       "event_action": "trigger",
       "payload": {
         "summary": "Test alert",
         "severity": "error",
         "source": "alertmanager"
       }
     }'
   ```

### Slack Not Receiving Alerts

1. **Verify webhook URL** is correct and not expired
2. **Check channel permissions** - bot must be invited to channel
3. **Test webhook directly:**
   ```bash
   curl -X POST YOUR_WEBHOOK_URL \
     -H 'Content-Type: application/json' \
     -d '{"text": "Test message"}'
   ```

### Email Not Being Sent

1. **Verify SMTP settings** (host, port, credentials)
2. **Check firewall rules** for SMTP port (usually 587 or 465)
3. **Review authentication** - use app password for Gmail
4. **Check spam folder** in recipient inbox

## Advanced Configuration

### High Availability Setup

Run multiple Alertmanager instances with gossip protocol:

```bash
# Instance 1
alertmanager --config.file=alertmanager.yml \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=alertmanager-2:9094 \
  --cluster.peer=alertmanager-3:9094

# Instance 2
alertmanager --config.file=alertmanager.yml \
  --cluster.listen-address=0.0.0.0:9094 \
  --cluster.peer=alertmanager-1:9094 \
  --cluster.peer=alertmanager-3:9094
```

### Custom Templates

Create custom message templates in `/etc/alertmanager/templates/`:

```go
{{ define "slack.default.title" }}
[{{ .Status | toUpper }}{{ if eq .Status "firing" }}:{{ .Alerts.Firing | len }}{{ end }}] {{ .GroupLabels.alertname }}
{{ end }}

{{ define "slack.default.text" }}
{{ range .Alerts }}
{{ .Annotations.description }}
{{ end }}
{{ end }}
```

Reference templates in `alertmanager.yml`:
```yaml
templates:
  - '/etc/alertmanager/templates/*.tmpl'
```

### Time-Based Routing

Route alerts differently based on time:

```yaml
routes:
  - match:
      severity: warning
    receiver: 'slack-warnings'
    # Business hours (Mon-Fri, 9am-5pm)
    time_intervals:
      - weekdays

  - match:
      severity: warning
    receiver: 'pagerduty-oncall'
    # Outside business hours
    mute_time_intervals:
      - weekdays

time_intervals:
  - name: weekdays
    time_intervals:
      - times:
          - start_time: '09:00'
            end_time: '17:00'
        weekdays: ['monday:friday']
```

## References

- [Alertmanager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [Alert Rules](../prometheus/alerts/authz-alerts.yml)
- [Runbook Documentation](https://docs.authz-engine.io/runbooks/)
- [PagerDuty API](https://developer.pagerduty.com/docs/events-api-v2/overview/)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)

## Support

For issues or questions:
- Create an issue in the GitHub repository
- Contact the AuthZ Platform team on Slack: #authz-platform-team
- Email: authz-oncall@example.com
