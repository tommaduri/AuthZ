package server

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

func setupTestServer(t *testing.T) (*Server, *policy.MemoryStore) {
	store := policy.NewMemoryStore()
	store.Add(&types.Policy{
		Name:         "test-policy",
		ResourceKind: "document",
		Rules: []*types.Rule{
			{
				Name:    "admin-all",
				Actions: []string{"*"},
				Effect:  types.EffectAllow,
				Roles:   []string{"admin"},
			},
			{
				Name:    "user-read",
				Actions: []string{"read"},
				Effect:  types.EffectAllow,
			},
		},
	})

	engConfig := engine.DefaultConfig()
	engConfig.CacheEnabled = false

	eng, err := engine.New(engConfig, store)
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	logger := zap.NewNop()
	srv, err := New(DefaultConfig(), eng, logger)
	if err != nil {
		t.Fatalf("Failed to create server: %v", err)
	}

	return srv, store
}

func TestServer_Check_Allow(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := &CheckRequest{
		RequestId: "test-1",
		Principal: &Principal{
			Id:    "user-1",
			Roles: []string{"admin"},
		},
		Resource: &Resource{
			Kind: "document",
			Id:   "doc-1",
		},
		Actions: []string{"read", "write", "delete"},
	}

	resp, err := srv.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	if resp.RequestId != "test-1" {
		t.Errorf("Expected request_id 'test-1', got '%s'", resp.RequestId)
	}

	// Admin should be allowed for all actions
	for _, action := range []string{"read", "write", "delete"} {
		result, ok := resp.Results[action]
		if !ok {
			t.Errorf("Missing result for action '%s'", action)
			continue
		}
		if result.Effect != Effect_EFFECT_ALLOW {
			t.Errorf("Expected allow for action '%s', got %v", action, result.Effect)
		}
	}
}

func TestServer_Check_Deny(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := &CheckRequest{
		RequestId: "test-2",
		Principal: &Principal{
			Id:    "user-2",
			Roles: []string{"user"}, // Not admin
		},
		Resource: &Resource{
			Kind: "document",
			Id:   "doc-1",
		},
		Actions: []string{"read", "write"},
	}

	resp, err := srv.Check(context.Background(), req)
	if err != nil {
		t.Fatalf("Check failed: %v", err)
	}

	// User should be allowed to read (user-read rule)
	if resp.Results["read"].Effect != Effect_EFFECT_ALLOW {
		t.Errorf("Expected allow for read, got %v", resp.Results["read"].Effect)
	}

	// User should be denied write (no matching rule)
	if resp.Results["write"].Effect != Effect_EFFECT_DENY {
		t.Errorf("Expected deny for write, got %v", resp.Results["write"].Effect)
	}
}

func TestServer_CheckBatch(t *testing.T) {
	srv, _ := setupTestServer(t)

	req := &CheckBatchRequest{
		Requests: []*CheckRequest{
			{
				RequestId: "batch-1",
				Principal: &Principal{Id: "user-1", Roles: []string{"admin"}},
				Resource:  &Resource{Kind: "document", Id: "doc-1"},
				Actions:   []string{"read"},
			},
			{
				RequestId: "batch-2",
				Principal: &Principal{Id: "user-2", Roles: []string{"user"}},
				Resource:  &Resource{Kind: "document", Id: "doc-2"},
				Actions:   []string{"read"},
			},
			{
				RequestId: "batch-3",
				Principal: &Principal{Id: "user-3", Roles: []string{"user"}},
				Resource:  &Resource{Kind: "document", Id: "doc-3"},
				Actions:   []string{"write"},
			},
		},
	}

	resp, err := srv.CheckBatch(context.Background(), req)
	if err != nil {
		t.Fatalf("CheckBatch failed: %v", err)
	}

	if len(resp.Responses) != 3 {
		t.Errorf("Expected 3 responses, got %d", len(resp.Responses))
	}

	// First request: admin read - should allow
	if resp.Responses[0].Results["read"].Effect != Effect_EFFECT_ALLOW {
		t.Errorf("Expected allow for batch-1 read")
	}

	// Second request: user read - should allow (user-read rule)
	if resp.Responses[1].Results["read"].Effect != Effect_EFFECT_ALLOW {
		t.Errorf("Expected allow for batch-2 read")
	}

	// Third request: user write - should deny
	if resp.Responses[2].Results["write"].Effect != Effect_EFFECT_DENY {
		t.Errorf("Expected deny for batch-3 write")
	}
}

func TestServer_NilEngine(t *testing.T) {
	logger := zap.NewNop()
	_, err := New(DefaultConfig(), nil, logger)
	if err == nil {
		t.Error("Expected error for nil engine")
	}
}

func TestServer_DefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.Port != 50051 {
		t.Errorf("Expected default port 50051, got %d", cfg.Port)
	}

	if cfg.MaxConcurrentStreams != 1000 {
		t.Errorf("Expected default max concurrent streams 1000, got %d", cfg.MaxConcurrentStreams)
	}

	if !cfg.EnableReflection {
		t.Error("Expected reflection to be enabled by default")
	}
}

func TestProtoToCheckRequest(t *testing.T) {
	protoReq := &CheckRequest{
		RequestId: "test-proto",
		Principal: &Principal{
			Id:    "user-1",
			Type:  "user",
			Roles: []string{"admin", "user"},
			Attributes: &Struct{
				Fields: map[string]*Value{
					"department": {Kind: &Value_StringValue{StringValue: "engineering"}},
				},
			},
		},
		Resource: &Resource{
			Kind: "document",
			Id:   "doc-123",
			Attributes: &Struct{
				Fields: map[string]*Value{
					"ownerId": {Kind: &Value_StringValue{StringValue: "user-1"}},
					"public":  {Kind: &Value_BoolValue{BoolValue: false}},
				},
			},
		},
		Actions: []string{"read", "write"},
	}

	internal := protoToCheckRequest(protoReq)

	if internal.RequestID != "test-proto" {
		t.Errorf("Expected request_id 'test-proto', got '%s'", internal.RequestID)
	}

	if internal.Principal.ID != "user-1" {
		t.Errorf("Expected principal ID 'user-1', got '%s'", internal.Principal.ID)
	}

	if len(internal.Principal.Roles) != 2 {
		t.Errorf("Expected 2 roles, got %d", len(internal.Principal.Roles))
	}

	if internal.Resource.Kind != "document" {
		t.Errorf("Expected resource kind 'document', got '%s'", internal.Resource.Kind)
	}

	if internal.Resource.ID != "doc-123" {
		t.Errorf("Expected resource ID 'doc-123', got '%s'", internal.Resource.ID)
	}

	if len(internal.Actions) != 2 {
		t.Errorf("Expected 2 actions, got %d", len(internal.Actions))
	}

	// Check attributes conversion
	if internal.Principal.Attributes["department"] != "engineering" {
		t.Errorf("Expected department 'engineering', got %v", internal.Principal.Attributes["department"])
	}

	if internal.Resource.Attributes["ownerId"] != "user-1" {
		t.Errorf("Expected ownerId 'user-1', got %v", internal.Resource.Attributes["ownerId"])
	}
}

func TestCheckResponseToProto(t *testing.T) {
	internal := &types.CheckResponse{
		RequestID: "test-response",
		Results: map[string]types.ActionResult{
			"read": {
				Effect:  types.EffectAllow,
				Policy:  "test-policy",
				Rule:    "user-read",
				Matched: true,
			},
			"write": {
				Effect:  types.EffectDeny,
				Matched: false,
			},
		},
		Metadata: &types.ResponseMetadata{
			EvaluationDurationUs: 123.45,
			PoliciesEvaluated:    2,
			CacheHit:             false,
		},
	}

	proto := checkResponseToProto(internal)

	if proto.RequestId != "test-response" {
		t.Errorf("Expected request_id 'test-response', got '%s'", proto.RequestId)
	}

	if proto.Results["read"].Effect != Effect_EFFECT_ALLOW {
		t.Errorf("Expected allow for read")
	}

	if proto.Results["read"].Policy != "test-policy" {
		t.Errorf("Expected policy 'test-policy', got '%s'", proto.Results["read"].Policy)
	}

	if proto.Results["write"].Effect != Effect_EFFECT_DENY {
		t.Errorf("Expected deny for write")
	}

	if proto.Metadata == nil {
		t.Fatal("Expected metadata")
	}

	if proto.Metadata.EvaluationDurationUs != 123.45 {
		t.Errorf("Expected duration 123.45, got %f", proto.Metadata.EvaluationDurationUs)
	}

	if proto.Metadata.PoliciesEvaluated != 2 {
		t.Errorf("Expected 2 policies evaluated, got %d", proto.Metadata.PoliciesEvaluated)
	}
}

func TestConvertStructToMap(t *testing.T) {
	// Test nil struct
	if result := convertStructToMap(nil); result != nil {
		t.Errorf("Expected nil for nil struct, got %v", result)
	}

	// Test struct with various value types
	s := &Struct{
		Fields: map[string]*Value{
			"string": {Kind: &Value_StringValue{StringValue: "hello"}},
			"number": {Kind: &Value_NumberValue{NumberValue: 42.5}},
			"bool":   {Kind: &Value_BoolValue{BoolValue: true}},
			"null":   {Kind: &Value_NullValue{}},
			"nested": {Kind: &Value_StructValue{StructValue: &Struct{
				Fields: map[string]*Value{
					"inner": {Kind: &Value_StringValue{StringValue: "world"}},
				},
			}}},
			"list": {Kind: &Value_ListValue{ListValue: &ListValue{
				Values: []*Value{
					{Kind: &Value_StringValue{StringValue: "a"}},
					{Kind: &Value_NumberValue{NumberValue: 1}},
				},
			}}},
		},
	}

	result := convertStructToMap(s)

	if result["string"] != "hello" {
		t.Errorf("Expected 'hello', got %v", result["string"])
	}

	if result["number"] != 42.5 {
		t.Errorf("Expected 42.5, got %v", result["number"])
	}

	if result["bool"] != true {
		t.Errorf("Expected true, got %v", result["bool"])
	}

	if result["null"] != nil {
		t.Errorf("Expected nil, got %v", result["null"])
	}

	nested, ok := result["nested"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected nested map, got %T", result["nested"])
	}
	if nested["inner"] != "world" {
		t.Errorf("Expected 'world', got %v", nested["inner"])
	}

	list, ok := result["list"].([]interface{})
	if !ok {
		t.Fatalf("Expected list, got %T", result["list"])
	}
	if len(list) != 2 {
		t.Errorf("Expected list length 2, got %d", len(list))
	}
	if list[0] != "a" {
		t.Errorf("Expected 'a', got %v", list[0])
	}
	if list[1] != float64(1) {
		t.Errorf("Expected 1, got %v", list[1])
	}
}
