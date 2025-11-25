// Package server provides the gRPC server implementation
package server

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"

	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// Server is the gRPC authorization server
type Server struct {
	engine         *engine.Engine
	grpcServer     *grpc.Server
	logger         *zap.Logger
	config         Config
	policyWatcher  *policy.FileWatcher
	pollingPath    string
	reloadMu       sync.RWMutex
	lastReloadTime time.Time
}

// Config configures the gRPC server
type Config struct {
	// Port is the TCP port to listen on
	Port int
	// MaxConcurrentStreams limits concurrent streams per connection
	MaxConcurrentStreams uint32
	// MaxRecvMsgSize is the maximum message size in bytes
	MaxRecvMsgSize int
	// MaxSendMsgSize is the maximum message size in bytes
	MaxSendMsgSize int
	// ConnectionTimeout is the timeout for establishing connections
	ConnectionTimeout time.Duration
	// KeepaliveTime is the interval for keepalive pings
	KeepaliveTime time.Duration
	// KeepaliveTimeout is the timeout for keepalive responses
	KeepaliveTimeout time.Duration
	// EnableReflection enables gRPC reflection for debugging
	EnableReflection bool
	// PolicyDirPath is the path to watch for policy file changes (optional)
	PolicyDirPath string
	// EnablePolicyWatcher enables automatic policy hot-reload (optional)
	EnablePolicyWatcher bool
}

// DefaultConfig returns default server configuration
func DefaultConfig() Config {
	return Config{
		Port:                 50051,
		MaxConcurrentStreams: 1000,
		MaxRecvMsgSize:       4 * 1024 * 1024,  // 4MB
		MaxSendMsgSize:       4 * 1024 * 1024,  // 4MB
		ConnectionTimeout:    30 * time.Second,
		KeepaliveTime:        30 * time.Second,
		KeepaliveTimeout:     10 * time.Second,
		EnableReflection:     true,
	}
}

// New creates a new gRPC server
func New(cfg Config, eng *engine.Engine, logger *zap.Logger) (*Server, error) {
	if eng == nil {
		return nil, fmt.Errorf("engine is required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	// Create interceptors
	loggingInterceptor := NewLoggingInterceptor(logger)
	metricsInterceptor := NewMetricsInterceptor()
	recoveryInterceptor := NewRecoveryInterceptor(logger)

	// Build gRPC server options
	opts := []grpc.ServerOption{
		grpc.MaxConcurrentStreams(cfg.MaxConcurrentStreams),
		grpc.MaxRecvMsgSize(cfg.MaxRecvMsgSize),
		grpc.MaxSendMsgSize(cfg.MaxSendMsgSize),
		grpc.ConnectionTimeout(cfg.ConnectionTimeout),
		grpc.KeepaliveParams(keepalive.ServerParameters{
			Time:    cfg.KeepaliveTime,
			Timeout: cfg.KeepaliveTimeout,
		}),
		grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
			MinTime:             5 * time.Second,
			PermitWithoutStream: true,
		}),
		grpc.ChainUnaryInterceptor(
			recoveryInterceptor.Unary(),
			loggingInterceptor.Unary(),
			metricsInterceptor.Unary(),
		),
		grpc.ChainStreamInterceptor(
			recoveryInterceptor.Stream(),
			loggingInterceptor.Stream(),
			metricsInterceptor.Stream(),
		),
	}

	grpcServer := grpc.NewServer(opts...)

	srv := &Server{
		engine:     eng,
		grpcServer: grpcServer,
		logger:     logger,
		config:     cfg,
	}

	// Register services
	RegisterAuthzServiceServer(grpcServer, srv)

	// Register health check service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
	healthServer.SetServingStatus("authz.v1.AuthzService", grpc_health_v1.HealthCheckResponse_SERVING)

	// Enable reflection for debugging
	if cfg.EnableReflection {
		reflection.Register(grpcServer)
	}

	return srv, nil
}

// Start starts the gRPC server
func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.config.Port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	s.logger.Info("Starting gRPC server",
		zap.Int("port", s.config.Port),
		zap.Bool("reflection", s.config.EnableReflection),
	)

	return s.grpcServer.Serve(lis)
}

// Stop gracefully stops the gRPC server
func (s *Server) Stop() {
	s.logger.Info("Stopping gRPC server")

	// Stop policy watcher if running
	if s.policyWatcher != nil && s.policyWatcher.IsWatching() {
		if err := s.policyWatcher.Stop(); err != nil {
			s.logger.Error("Error stopping policy watcher", zap.Error(err))
		}
	}

	s.grpcServer.GracefulStop()
}

// EnablePolicyWatcher starts watching for policy file changes
func (s *Server) EnablePolicyWatcher(ctx context.Context, pollingPath string) error {
	if s.policyWatcher != nil {
		return fmt.Errorf("policy watcher is already enabled")
	}

	// Get the memory store from the engine
	memStore, ok := s.engine.GetStore().(*policy.MemoryStore)
	if !ok {
		return fmt.Errorf("policy watcher requires a MemoryStore implementation")
	}

	// Create loader and watcher
	loader := policy.NewLoader(s.logger)
	watcher, err := policy.NewFileWatcher(pollingPath, memStore, loader, s.logger)
	if err != nil {
		return fmt.Errorf("failed to create policy watcher: %w", err)
	}

	// Start watching
	if err := watcher.Watch(ctx); err != nil {
		return fmt.Errorf("failed to start policy watcher: %w", err)
	}

	// Monitor reload events in a background goroutine
	go s.handleReloadEvents(watcher.EventChan())

	s.policyWatcher = watcher
	s.pollingPath = pollingPath
	s.logger.Info("Policy watcher enabled",
		zap.String("path", pollingPath),
	)

	return nil
}

// handleReloadEvents processes policy reload events from the watcher
func (s *Server) handleReloadEvents(eventChan <-chan policy.ReloadedEvent) {
	for event := range eventChan {
		if event.Error != nil {
			s.logger.Error("Policy reload failed",
				zap.Time("timestamp", event.Timestamp),
				zap.Error(event.Error),
			)
			continue
		}

		s.reloadMu.Lock()
		s.lastReloadTime = event.Timestamp
		s.reloadMu.Unlock()

		s.logger.Info("Policies reloaded successfully",
			zap.Time("timestamp", event.Timestamp),
			zap.Int("count", len(event.PolicyIDs)),
			zap.Strings("policies", event.PolicyIDs),
		)
	}
}

// ReloadPolicies manually triggers a policy reload
func (s *Server) ReloadPolicies(ctx context.Context) error {
	if s.policyWatcher == nil {
		return fmt.Errorf("policy watcher is not enabled")
	}

	// Trigger reload by the watcher's performReload method
	// For now, we'll reload by reading from the filesystem directly
	memStore, ok := s.engine.GetStore().(*policy.MemoryStore)
	if !ok {
		return fmt.Errorf("policy store is not a MemoryStore")
	}

	loader := policy.NewLoader(s.logger)
	reloadPath := s.pollingPath

	// Load all policies
	policies, err := loader.LoadFromDirectory(reloadPath)
	if err != nil {
		s.logger.Error("Failed to reload policies",
			zap.String("path", reloadPath),
			zap.Error(err),
		)
		return err
	}

	// Validate all policies
	validator := policy.NewValidator()
	for _, p := range policies {
		if err := validator.ValidatePolicy(p); err != nil {
			s.logger.Error("Policy validation failed",
				zap.String("policy", p.Name),
				zap.Error(err),
			)
			return err
		}
	}

	// Clear and reload policies
	memStore.Clear()
	policyNames := make([]string, 0, len(policies))
	for _, p := range policies {
		if err := memStore.Add(p); err != nil {
			s.logger.Error("Failed to add policy",
				zap.String("policy", p.Name),
				zap.Error(err),
			)
			return err
		}
		policyNames = append(policyNames, p.Name)
	}

	s.reloadMu.Lock()
	s.lastReloadTime = time.Now()
	s.reloadMu.Unlock()

	s.logger.Info("Policies reloaded manually",
		zap.Int("count", len(policies)),
		zap.Strings("policies", policyNames),
	)

	return nil
}

// GetLastReloadTime returns the last time policies were reloaded
func (s *Server) GetLastReloadTime() time.Time {
	s.reloadMu.RLock()
	defer s.reloadMu.RUnlock()
	return s.lastReloadTime
}

// IsPolicyWatcherRunning returns true if the policy watcher is active
func (s *Server) IsPolicyWatcherRunning() bool {
	if s.policyWatcher == nil {
		return false
	}
	return s.policyWatcher.IsWatching()
}

// Check implements the Check RPC method
func (s *Server) Check(ctx interface{}, req *CheckRequest) (*CheckResponse, error) {
	// Convert protobuf request to internal types
	internalReq := protoToCheckRequest(req)

	// Execute authorization check
	resp, err := s.engine.Check(ctx.(context.Context), internalReq)
	if err != nil {
		s.logger.Error("Authorization check failed",
			zap.String("request_id", req.RequestId),
			zap.Error(err),
		)
		return nil, status.Errorf(codes.Internal, "authorization check failed: %v", err)
	}

	// Convert internal response to protobuf
	return checkResponseToProto(resp), nil
}

// CheckBatch implements the CheckBatch RPC method
func (s *Server) CheckBatch(ctx interface{}, req *CheckBatchRequest) (*CheckBatchResponse, error) {
	// Convert protobuf requests to internal types
	internalReqs := make([]*types.CheckRequest, len(req.Requests))
	for i, r := range req.Requests {
		internalReqs[i] = protoToCheckRequest(r)
	}

	// Execute batch authorization check
	responses, err := s.engine.CheckBatch(ctx.(context.Context), internalReqs)
	if err != nil {
		s.logger.Error("Batch authorization check failed",
			zap.Int("request_count", len(req.Requests)),
			zap.Error(err),
		)
		return nil, status.Errorf(codes.Internal, "batch authorization check failed: %v", err)
	}

	// Convert internal responses to protobuf
	protoResponses := make([]*CheckResponse, len(responses))
	for i, resp := range responses {
		protoResponses[i] = checkResponseToProto(resp)
	}

	return &CheckBatchResponse{
		Responses: protoResponses,
	}, nil
}

// CheckStream implements the CheckStream RPC method (bidirectional streaming)
func (s *Server) CheckStream(stream AuthzService_CheckStreamServer) error {
	for {
		req, err := stream.Recv()
		if err != nil {
			if err.Error() == "EOF" {
				return nil
			}
			return status.Errorf(codes.Internal, "failed to receive request: %v", err)
		}

		// Convert and execute check
		internalReq := protoToCheckRequest(req)
		resp, err := s.engine.Check(stream.Context().(context.Context), internalReq)
		if err != nil {
			s.logger.Error("Stream authorization check failed",
				zap.String("request_id", req.RequestId),
				zap.Error(err),
			)
			// Send error response instead of failing stream
			errResp := &CheckResponse{
				RequestId: req.RequestId,
				Error:     err.Error(),
			}
			if err := stream.Send(errResp); err != nil {
				return status.Errorf(codes.Internal, "failed to send error response: %v", err)
			}
			continue
		}

		// Send response
		if err := stream.Send(checkResponseToProto(resp)); err != nil {
			return status.Errorf(codes.Internal, "failed to send response: %v", err)
		}
	}
}

// protoToCheckRequest converts a protobuf CheckRequest to internal types
func protoToCheckRequest(req *CheckRequest) *types.CheckRequest {
	principal := &types.Principal{
		ID:         req.Principal.Id,
		Roles:      req.Principal.Roles,
		Attributes: convertStructToMap(req.Principal.Attributes),
	}

	resource := &types.Resource{
		Kind:       req.Resource.Kind,
		ID:         req.Resource.Id,
		Attributes: convertStructToMap(req.Resource.Attributes),
	}

	return &types.CheckRequest{
		RequestID: req.RequestId,
		Principal: principal,
		Resource:  resource,
		Actions:   req.Actions,
		Context:   convertStructToMap(req.Context),
	}
}

// checkResponseToProto converts internal CheckResponse to protobuf
func checkResponseToProto(resp *types.CheckResponse) *CheckResponse {
	results := make(map[string]*ActionResult)
	for action, result := range resp.Results {
		effect := Effect_EFFECT_DENY
		if result.Effect == types.EffectAllow {
			effect = Effect_EFFECT_ALLOW
		}

		results[action] = &ActionResult{
			Effect:  effect,
			Policy:  result.Policy,
			Rule:    result.Rule,
			Matched: result.Matched,
		}
	}

	protoResp := &CheckResponse{
		RequestId: resp.RequestID,
		Results:   results,
	}

	if resp.Metadata != nil {
		protoResp.Metadata = &ResponseMetadata{
			EvaluationDurationUs: resp.Metadata.EvaluationDurationUs,
			PoliciesEvaluated:    int32(resp.Metadata.PoliciesEvaluated),
			CacheHit:             resp.Metadata.CacheHit,
		}
	}

	return protoResp
}

// convertStructToMap converts a protobuf Struct to a Go map
func convertStructToMap(s *Struct) map[string]interface{} {
	if s == nil {
		return nil
	}

	result := make(map[string]interface{})
	for k, v := range s.Fields {
		result[k] = convertValue(v)
	}
	return result
}

// convertValue converts a protobuf Value to a Go value
func convertValue(v *Value) interface{} {
	if v == nil {
		return nil
	}

	switch k := v.Kind.(type) {
	case *Value_NullValue:
		return nil
	case *Value_NumberValue:
		return k.NumberValue
	case *Value_StringValue:
		return k.StringValue
	case *Value_BoolValue:
		return k.BoolValue
	case *Value_StructValue:
		return convertStructToMap(k.StructValue)
	case *Value_ListValue:
		list := make([]interface{}, len(k.ListValue.Values))
		for i, item := range k.ListValue.Values {
			list[i] = convertValue(item)
		}
		return list
	default:
		return nil
	}
}
