package server

import (
	"context"
	"runtime/debug"
	"sync/atomic"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// LoggingInterceptor provides request logging
type LoggingInterceptor struct {
	logger *zap.Logger
}

// NewLoggingInterceptor creates a new logging interceptor
func NewLoggingInterceptor(logger *zap.Logger) *LoggingInterceptor {
	return &LoggingInterceptor{logger: logger}
}

// Unary returns a unary server interceptor for logging
func (i *LoggingInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()

		resp, err := handler(ctx, req)

		duration := time.Since(start)
		code := codes.OK
		if err != nil {
			code = status.Code(err)
		}

		i.logger.Info("gRPC request",
			zap.String("method", info.FullMethod),
			zap.Duration("duration", duration),
			zap.String("code", code.String()),
		)

		return resp, err
	}
}

// Stream returns a stream server interceptor for logging
func (i *LoggingInterceptor) Stream() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		start := time.Now()

		err := handler(srv, ss)

		duration := time.Since(start)
		code := codes.OK
		if err != nil {
			code = status.Code(err)
		}

		i.logger.Info("gRPC stream",
			zap.String("method", info.FullMethod),
			zap.Duration("duration", duration),
			zap.String("code", code.String()),
		)

		return err
	}
}

// MetricsInterceptor provides request metrics collection
type MetricsInterceptor struct {
	totalRequests   int64
	successRequests int64
	failedRequests  int64
	totalDuration   int64 // nanoseconds
}

// NewMetricsInterceptor creates a new metrics interceptor
func NewMetricsInterceptor() *MetricsInterceptor {
	return &MetricsInterceptor{}
}

// Unary returns a unary server interceptor for metrics
func (i *MetricsInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		start := time.Now()

		resp, err := handler(ctx, req)

		duration := time.Since(start)
		atomic.AddInt64(&i.totalRequests, 1)
		atomic.AddInt64(&i.totalDuration, int64(duration))

		if err != nil {
			atomic.AddInt64(&i.failedRequests, 1)
		} else {
			atomic.AddInt64(&i.successRequests, 1)
		}

		return resp, err
	}
}

// Stream returns a stream server interceptor for metrics
func (i *MetricsInterceptor) Stream() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		atomic.AddInt64(&i.totalRequests, 1)

		err := handler(srv, ss)

		if err != nil {
			atomic.AddInt64(&i.failedRequests, 1)
		} else {
			atomic.AddInt64(&i.successRequests, 1)
		}

		return err
	}
}

// Stats returns current metrics
func (i *MetricsInterceptor) Stats() MetricsStats {
	total := atomic.LoadInt64(&i.totalRequests)
	success := atomic.LoadInt64(&i.successRequests)
	failed := atomic.LoadInt64(&i.failedRequests)
	duration := atomic.LoadInt64(&i.totalDuration)

	avgDuration := float64(0)
	if total > 0 {
		avgDuration = float64(duration) / float64(total) / float64(time.Millisecond)
	}

	return MetricsStats{
		TotalRequests:     total,
		SuccessfulRequests: success,
		FailedRequests:    failed,
		AvgDurationMs:     avgDuration,
	}
}

// MetricsStats contains server metrics
type MetricsStats struct {
	TotalRequests      int64
	SuccessfulRequests int64
	FailedRequests     int64
	AvgDurationMs      float64
}

// RecoveryInterceptor provides panic recovery
type RecoveryInterceptor struct {
	logger *zap.Logger
}

// NewRecoveryInterceptor creates a new recovery interceptor
func NewRecoveryInterceptor(logger *zap.Logger) *RecoveryInterceptor {
	return &RecoveryInterceptor{logger: logger}
}

// Unary returns a unary server interceptor for panic recovery
func (i *RecoveryInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (resp interface{}, err error) {
		defer func() {
			if r := recover(); r != nil {
				i.logger.Error("Panic recovered in gRPC handler",
					zap.Any("panic", r),
					zap.String("method", info.FullMethod),
					zap.String("stack", string(debug.Stack())),
				)
				err = status.Errorf(codes.Internal, "internal server error")
			}
		}()

		return handler(ctx, req)
	}
}

// Stream returns a stream server interceptor for panic recovery
func (i *RecoveryInterceptor) Stream() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) (err error) {
		defer func() {
			if r := recover(); r != nil {
				i.logger.Error("Panic recovered in gRPC stream handler",
					zap.Any("panic", r),
					zap.String("method", info.FullMethod),
					zap.String("stack", string(debug.Stack())),
				)
				err = status.Errorf(codes.Internal, "internal server error")
			}
		}()

		return handler(srv, ss)
	}
}

// RateLimitInterceptor provides rate limiting
type RateLimitInterceptor struct {
	limiter *RateLimiter
}

// RateLimiter implements a simple token bucket rate limiter
type RateLimiter struct {
	tokens     int64
	maxTokens  int64
	refillRate int64 // tokens per second
	lastRefill int64 // unix nano
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(maxTokens, refillRate int64) *RateLimiter {
	return &RateLimiter{
		tokens:     maxTokens,
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now().UnixNano(),
	}
}

// Allow checks if a request should be allowed
func (r *RateLimiter) Allow() bool {
	now := time.Now().UnixNano()

	// Calculate tokens to add based on time elapsed
	elapsed := now - atomic.LoadInt64(&r.lastRefill)
	tokensToAdd := elapsed * r.refillRate / int64(time.Second)

	if tokensToAdd > 0 {
		atomic.StoreInt64(&r.lastRefill, now)
		current := atomic.LoadInt64(&r.tokens)
		newTokens := current + tokensToAdd
		if newTokens > r.maxTokens {
			newTokens = r.maxTokens
		}
		atomic.StoreInt64(&r.tokens, newTokens)
	}

	// Try to consume a token
	for {
		current := atomic.LoadInt64(&r.tokens)
		if current <= 0 {
			return false
		}
		if atomic.CompareAndSwapInt64(&r.tokens, current, current-1) {
			return true
		}
	}
}

// NewRateLimitInterceptor creates a new rate limit interceptor
func NewRateLimitInterceptor(maxRPS int64) *RateLimitInterceptor {
	return &RateLimitInterceptor{
		limiter: NewRateLimiter(maxRPS, maxRPS),
	}
}

// Unary returns a unary server interceptor for rate limiting
func (i *RateLimitInterceptor) Unary() grpc.UnaryServerInterceptor {
	return func(
		ctx context.Context,
		req interface{},
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (interface{}, error) {
		if !i.limiter.Allow() {
			return nil, status.Errorf(codes.ResourceExhausted, "rate limit exceeded")
		}
		return handler(ctx, req)
	}
}

// Stream returns a stream server interceptor for rate limiting
func (i *RateLimitInterceptor) Stream() grpc.StreamServerInterceptor {
	return func(
		srv interface{},
		ss grpc.ServerStream,
		info *grpc.StreamServerInfo,
		handler grpc.StreamHandler,
	) error {
		if !i.limiter.Allow() {
			return status.Errorf(codes.ResourceExhausted, "rate limit exceeded")
		}
		return handler(srv, ss)
	}
}
