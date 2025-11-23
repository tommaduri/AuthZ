package server

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
)

// Mock handler for testing
func mockHandler(ctx context.Context, req interface{}) (interface{}, error) {
	return "response", nil
}

func mockHandlerError(ctx context.Context, req interface{}) (interface{}, error) {
	return nil, errors.New("handler error")
}

func mockHandlerPanic(ctx context.Context, req interface{}) (interface{}, error) {
	panic("test panic")
}

func mockHandlerSlow(ctx context.Context, req interface{}) (interface{}, error) {
	time.Sleep(10 * time.Millisecond)
	return "response", nil
}

func TestLoggingInterceptor_Unary(t *testing.T) {
	logger := zap.NewNop()
	interceptor := NewLoggingInterceptor(logger)

	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// Test successful request
	resp, err := unary(context.Background(), nil, info, mockHandler)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
	if resp != "response" {
		t.Errorf("Expected 'response', got %v", resp)
	}

	// Test error request
	resp, err = unary(context.Background(), nil, info, mockHandlerError)
	if err == nil {
		t.Error("Expected error")
	}
	if resp != nil {
		t.Errorf("Expected nil response, got %v", resp)
	}
}

func TestMetricsInterceptor_Unary(t *testing.T) {
	interceptor := NewMetricsInterceptor()

	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// Make some requests
	for i := 0; i < 10; i++ {
		unary(context.Background(), nil, info, mockHandler)
	}

	// Make some failing requests
	for i := 0; i < 5; i++ {
		unary(context.Background(), nil, info, mockHandlerError)
	}

	// Check stats
	stats := interceptor.Stats()

	if stats.TotalRequests != 15 {
		t.Errorf("Expected 15 total requests, got %d", stats.TotalRequests)
	}

	if stats.SuccessfulRequests != 10 {
		t.Errorf("Expected 10 successful requests, got %d", stats.SuccessfulRequests)
	}

	if stats.FailedRequests != 5 {
		t.Errorf("Expected 5 failed requests, got %d", stats.FailedRequests)
	}
}

func TestMetricsInterceptor_Concurrent(t *testing.T) {
	interceptor := NewMetricsInterceptor()
	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// Make concurrent requests
	var wg sync.WaitGroup
	numRequests := 100

	for i := 0; i < numRequests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unary(context.Background(), nil, info, mockHandler)
		}()
	}

	wg.Wait()

	stats := interceptor.Stats()

	if stats.TotalRequests != int64(numRequests) {
		t.Errorf("Expected %d total requests, got %d", numRequests, stats.TotalRequests)
	}

	if stats.SuccessfulRequests != int64(numRequests) {
		t.Errorf("Expected %d successful requests, got %d", numRequests, stats.SuccessfulRequests)
	}
}

func TestRecoveryInterceptor_Unary(t *testing.T) {
	logger := zap.NewNop()
	interceptor := NewRecoveryInterceptor(logger)

	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// Test panic recovery
	resp, err := unary(context.Background(), nil, info, mockHandlerPanic)

	if err == nil {
		t.Error("Expected error from recovered panic")
	}

	if resp != nil {
		t.Errorf("Expected nil response, got %v", resp)
	}
}

func TestRateLimiter(t *testing.T) {
	limiter := NewRateLimiter(10, 10) // 10 tokens, 10/sec refill

	// Should allow first 10 requests immediately
	for i := 0; i < 10; i++ {
		if !limiter.Allow() {
			t.Errorf("Request %d should be allowed", i)
		}
	}

	// 11th request should be denied
	if limiter.Allow() {
		t.Error("Request 11 should be denied")
	}

	// Wait for refill
	time.Sleep(200 * time.Millisecond)

	// Should allow a couple more requests
	if !limiter.Allow() {
		t.Error("Request after refill should be allowed")
	}
}

func TestRateLimitInterceptor(t *testing.T) {
	interceptor := NewRateLimitInterceptor(5) // 5 requests per second

	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// First 5 should succeed
	for i := 0; i < 5; i++ {
		_, err := unary(context.Background(), nil, info, mockHandler)
		if err != nil {
			t.Errorf("Request %d should succeed, got error: %v", i, err)
		}
	}

	// 6th should be rate limited
	_, err := unary(context.Background(), nil, info, mockHandler)
	if err == nil {
		t.Error("Request 6 should be rate limited")
	}
}

func TestMetricsInterceptor_AvgDuration(t *testing.T) {
	interceptor := NewMetricsInterceptor()
	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	// Make slow requests
	for i := 0; i < 3; i++ {
		unary(context.Background(), nil, info, mockHandlerSlow)
	}

	stats := interceptor.Stats()

	// Average duration should be at least 10ms
	if stats.AvgDurationMs < 10 {
		t.Errorf("Expected avg duration >= 10ms, got %f", stats.AvgDurationMs)
	}
}

func BenchmarkLoggingInterceptor(b *testing.B) {
	logger := zap.NewNop()
	interceptor := NewLoggingInterceptor(logger)
	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		unary(context.Background(), nil, info, mockHandler)
	}
}

func BenchmarkMetricsInterceptor(b *testing.B) {
	interceptor := NewMetricsInterceptor()
	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		unary(context.Background(), nil, info, mockHandler)
	}
}

func BenchmarkRecoveryInterceptor(b *testing.B) {
	logger := zap.NewNop()
	interceptor := NewRecoveryInterceptor(logger)
	unary := interceptor.Unary()

	info := &grpc.UnaryServerInfo{
		FullMethod: "/authz.v1.AuthzService/Check",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		unary(context.Background(), nil, info, mockHandler)
	}
}

func BenchmarkRateLimiter(b *testing.B) {
	limiter := NewRateLimiter(int64(b.N*2), int64(b.N*2))

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		limiter.Allow()
	}
}
