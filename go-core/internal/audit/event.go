package audit

import (
	"time"
)

// EventType represents the type of audit event
type EventType string

const (
	EventTypeAuthzCheck    EventType = "authz_check"
	EventTypePolicyChange  EventType = "policy_change"
	EventTypeAgentAction   EventType = "agent_action"
	EventTypeSystemStartup EventType = "system_startup"
	EventTypeSystemShutdown EventType = "system_shutdown"
)

// Decision represents authorization decision
type Decision string

const (
	DecisionAllow Decision = "allow"
	DecisionDeny  Decision = "deny"
)

// Event represents a generic audit event
type Event struct {
	Timestamp time.Time              `json:"timestamp"`
	EventType EventType              `json:"event_type"`
	EventID   string                 `json:"event_id"`
	RequestID string                 `json:"request_id,omitempty"`
	TraceID   string                 `json:"trace_id,omitempty"`
	SpanID    string                 `json:"span_id,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

// AuthzCheckEvent represents authorization check event
type AuthzCheckEvent struct {
	Timestamp   time.Time              `json:"timestamp"`
	EventType   EventType              `json:"event_type"`
	EventID     string                 `json:"event_id"`
	RequestID   string                 `json:"request_id,omitempty"`
	TraceID     string                 `json:"trace_id,omitempty"`
	SpanID      string                 `json:"span_id,omitempty"`
	Principal   Principal              `json:"principal"`
	Resource    Resource               `json:"resource"`
	Action      string                 `json:"action"`
	Decision    Decision               `json:"decision"`
	Policies    []PolicyMatch          `json:"policies,omitempty"`
	Performance Performance            `json:"performance"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// Principal represents the entity making the request
type Principal struct {
	ID         string                 `json:"id"`
	Roles      []string               `json:"roles,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// Resource represents the resource being accessed
type Resource struct {
	Kind       string                 `json:"kind"`
	ID         string                 `json:"id"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// PolicyMatch represents a matched policy
type PolicyMatch struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Matched bool   `json:"matched"`
}

// Performance contains performance metrics
type Performance struct {
	DurationUs int64 `json:"duration_us"`
	CacheHit   bool  `json:"cache_hit"`
}

// PolicyChangeEvent represents policy change event
type PolicyChangeEvent struct {
	Timestamp     time.Time              `json:"timestamp"`
	EventType     EventType              `json:"event_type"`
	EventID       string                 `json:"event_id"`
	RequestID     string                 `json:"request_id,omitempty"`
	Operation     string                 `json:"operation"` // create, update, delete
	PolicyID      string                 `json:"policy_id"`
	PolicyVersion string                 `json:"policy_version"`
	Actor         Actor                  `json:"actor"`
	Changes       interface{}            `json:"changes,omitempty"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// AgentActionEvent represents agent operation event
type AgentActionEvent struct {
	Timestamp time.Time              `json:"timestamp"`
	EventType EventType              `json:"event_type"`
	EventID   string                 `json:"event_id"`
	RequestID string                 `json:"request_id,omitempty"`
	Operation string                 `json:"operation"` // register, revoke, update
	AgentID   string                 `json:"agent_id"`
	AgentType string                 `json:"agent_type"`
	Actor     Actor                  `json:"actor"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// Actor represents the entity performing an action
type Actor struct {
	ID    string   `json:"id"`
	Roles []string `json:"roles,omitempty"`
}

// PolicyChange represents policy change details
type PolicyChange struct {
	Operation     string
	PolicyID      string
	PolicyVersion string
	ActorID       string
	ActorRoles    []string
	Changes       interface{}
	SourceIP      string
	UserAgent     string
}

// AgentAction represents agent operation details
type AgentAction struct {
	Operation  string
	AgentID    string
	AgentType  string
	ActorID    string
	ActorRoles []string
	SourceIP   string
	UserAgent  string
}
