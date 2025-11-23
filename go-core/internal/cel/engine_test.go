package cel

import (
	"testing"
)

func TestEngine_Compile(t *testing.T) {
	engine, err := NewEngine()
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	tests := []struct {
		name    string
		expr    string
		wantErr bool
	}{
		{
			name:    "simple boolean",
			expr:    "true",
			wantErr: false,
		},
		{
			name:    "principal role check",
			expr:    `"admin" in principal.roles`,
			wantErr: false,
		},
		{
			name:    "resource attribute access",
			expr:    `resource.attributes.visibility == "public"`,
			wantErr: false,
		},
		{
			name:    "complex condition",
			expr:    `"admin" in P.roles || (R.attributes.ownerId == P.id)`,
			wantErr: false,
		},
		{
			name:    "invalid syntax",
			expr:    `this is not valid CEL`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := engine.Compile(tt.expr)
			if (err != nil) != tt.wantErr {
				t.Errorf("Compile() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestEngine_Evaluate(t *testing.T) {
	engine, err := NewEngine()
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	tests := []struct {
		name    string
		expr    string
		ctx     *EvalContext
		want    bool
		wantErr bool
	}{
		{
			name: "admin role check - true",
			expr: `"admin" in principal.roles`,
			ctx: &EvalContext{
				Principal: map[string]interface{}{
					"id":    "user-1",
					"roles": []interface{}{"admin", "user"},
				},
			},
			want:    true,
			wantErr: false,
		},
		{
			name: "admin role check - false",
			expr: `"admin" in principal.roles`,
			ctx: &EvalContext{
				Principal: map[string]interface{}{
					"id":    "user-1",
					"roles": []interface{}{"user"},
				},
			},
			want:    false,
			wantErr: false,
		},
		{
			name: "owner check",
			expr: `resource.attributes.ownerId == principal.id`,
			ctx: &EvalContext{
				Principal: map[string]interface{}{
					"id": "user-123",
				},
				Resource: map[string]interface{}{
					"kind": "document",
					"id":   "doc-1",
					"attributes": map[string]interface{}{
						"ownerId": "user-123",
					},
				},
			},
			want:    true,
			wantErr: false,
		},
		{
			name: "visibility check",
			expr: `resource.attributes.visibility == "public"`,
			ctx: &EvalContext{
				Resource: map[string]interface{}{
					"attributes": map[string]interface{}{
						"visibility": "public",
					},
				},
			},
			want:    true,
			wantErr: false,
		},
		{
			name: "combined admin or owner",
			expr: `"admin" in P.roles || R.attributes.ownerId == P.id`,
			ctx: &EvalContext{
				Principal: map[string]interface{}{
					"id":    "user-123",
					"roles": []interface{}{"user"},
				},
				Resource: map[string]interface{}{
					"attributes": map[string]interface{}{
						"ownerId": "user-123",
					},
				},
			},
			want:    true,
			wantErr: false,
		},
		{
			name: "context data access",
			expr: `context.requestTime > 0`,
			ctx: &EvalContext{
				Context: map[string]interface{}{
					"requestTime": int64(1234567890),
				},
			},
			want:    true,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Ensure all context fields are initialized
			if tt.ctx.Principal == nil {
				tt.ctx.Principal = map[string]interface{}{}
			}
			if tt.ctx.Resource == nil {
				tt.ctx.Resource = map[string]interface{}{}
			}
			if tt.ctx.Request == nil {
				tt.ctx.Request = map[string]interface{}{}
			}
			if tt.ctx.Context == nil {
				tt.ctx.Context = map[string]interface{}{}
			}

			got, err := engine.EvaluateExpression(tt.expr, tt.ctx)
			if (err != nil) != tt.wantErr {
				t.Errorf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("Evaluate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEngine_CachesProgramsCorrectly(t *testing.T) {
	engine, err := NewEngine()
	if err != nil {
		t.Fatalf("Failed to create engine: %v", err)
	}

	expr := `"admin" in principal.roles`

	// Compile twice
	prog1, err := engine.Compile(expr)
	if err != nil {
		t.Fatalf("First compile failed: %v", err)
	}

	prog2, err := engine.Compile(expr)
	if err != nil {
		t.Fatalf("Second compile failed: %v", err)
	}

	// Should be the same cached program
	if prog1 != prog2 {
		t.Error("Expected cached program to be returned")
	}
}

func BenchmarkEngine_Compile(b *testing.B) {
	engine, _ := NewEngine()
	expr := `"admin" in principal.roles || resource.attributes.ownerId == principal.id`

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Compile(expr)
	}
}

func BenchmarkEngine_Evaluate(b *testing.B) {
	engine, _ := NewEngine()
	expr := `"admin" in principal.roles || resource.attributes.ownerId == principal.id`
	prog, _ := engine.Compile(expr)

	ctx := &EvalContext{
		Principal: map[string]interface{}{
			"id":    "user-123",
			"roles": []interface{}{"user"},
		},
		Resource: map[string]interface{}{
			"kind": "document",
			"id":   "doc-1",
			"attributes": map[string]interface{}{
				"ownerId": "user-123",
			},
		},
		Request: map[string]interface{}{},
		Context: map[string]interface{}{},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		engine.Evaluate(prog, ctx)
	}
}
