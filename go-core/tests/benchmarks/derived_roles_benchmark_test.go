package benchmarks_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/authz-engine/go-core/internal/derived_roles"
	"github.com/authz-engine/go-core/internal/engine"
	"github.com/authz-engine/go-core/internal/policy"
	"github.com/authz-engine/go-core/pkg/types"
)

// BenchmarkResolve benchmarks the resolution of derived roles
func BenchmarkResolve(b *testing.B) {
	resolver, err := derived_roles.NewDerivedRolesResolver()
	if err != nil {
		b.Fatalf("Failed to create resolver: %v", err)
	}

	// Create test derived roles
	derivedRolesList := []*types.DerivedRole{
		{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		},
		{
			Name:        "editor",
			ParentRoles: []string{"user"},
			Condition:   "P.id in R.attr.editors",
		},
		{
			Name:        "viewer",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.public == true",
		},
	}

	principal := &types.Principal{
		ID:    "user123",
		Roles: []string{"user"},
	}
	resource := &types.Resource{
		Kind: "document",
		ID:   "doc1",
		Attributes: map[string]interface{}{
			"ownerId": "user123",
			"editors": []string{"user123", "user456"},
			"public":  true,
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		roles, _ := resolver.Resolve(principal, resource, derivedRolesList)
		_ = roles
	}
}

// BenchmarkResolveWithCache benchmarks cached resolution
func BenchmarkResolveWithCache(b *testing.B) {
	resolver, err := derived_roles.NewDerivedRolesResolver()
	if err != nil {
		b.Fatalf("Failed to create resolver: %v", err)
	}

	derivedRolesList := []*types.DerivedRole{
		{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		},
	}

	cache := derived_roles.NewDerivedRolesCache()
	principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
	resource := &types.Resource{
		Kind:       "document",
		Attributes: map[string]interface{}{"ownerId": "user123"},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// Check cache first
		roles, found := cache.Get(principal, resource)
		if !found {
			roles, _ = resolver.Resolve(principal, resource, derivedRolesList)
			cache.Set(principal, resource, roles)
		}
		_ = roles
	}
}

// BenchmarkCache benchmarks cache operations
func BenchmarkCache(b *testing.B) {
	b.Run("Set", func(b *testing.B) {
		cache := derived_roles.NewDerivedRolesCache()
		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}
		roles := []string{"owner", "viewer"}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			cache.Set(principal, resource, roles)
		}
	})

	b.Run("Get_Hit", func(b *testing.B) {
		cache := derived_roles.NewDerivedRolesCache()
		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		cache.Set(principal, resource, []string{"owner", "viewer"})

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = cache.Get(principal, resource)
		}
	})

	b.Run("Clear", func(b *testing.B) {
		cache := derived_roles.NewDerivedRolesCache()
		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// Populate
			for j := 0; j < 100; j++ {
				cache.Set(principal, resource, []string{"role1"})
			}
			// Clear
			cache.Clear()
		}
	})
}

// BenchmarkIntegration benchmarks end-to-end integration
func BenchmarkIntegration(b *testing.B) {
	b.Run("EndToEnd_SimplePolicy", func(b *testing.B) {
		// Create policy store
		store := policy.NewMemoryStore()

		// Add resource policy
		resourcePolicy := &types.Policy{
			Name:         "document-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "read-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"owner"},
				},
			},
		}
		store.Add(resourcePolicy)

		// Add derived roles
		derivedRole := &types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		}
		store.AddDerivedRole(derivedRole)

		// Create engine
		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		if err != nil {
			b.Fatalf("Failed to create engine: %v", err)
		}

		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{
			Kind:       "document",
			Attributes: map[string]interface{}{"ownerId": "user123"},
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := &types.CheckRequest{
				Principal: principal,
				Resource:  resource,
				Actions:   []string{"read"},
			}
			_, _ = eng.Check(context.Background(), req)
		}
	})

	b.Run("EndToEnd_MultipleRoles", func(b *testing.B) {
		store := policy.NewMemoryStore()

		resourcePolicy := &types.Policy{
			Name:         "document-policy",
			ResourceKind: "document",
			Rules: []*types.Rule{
				{
					Name:    "read-rule",
					Actions: []string{"read"},
					Effect:  types.EffectAllow,
					Roles:   []string{"owner", "editor", "viewer"},
				},
			},
		}
		store.Add(resourcePolicy)

		// Multiple derived roles
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "owner",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.ownerId == P.id",
		})
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "editor",
			ParentRoles: []string{"user"},
			Condition:   "P.id in R.attr.editors",
		})
		store.AddDerivedRole(&types.DerivedRole{
			Name:        "viewer",
			ParentRoles: []string{"user"},
			Condition:   "R.attr.public == true",
		})

		cfg := engine.DefaultConfig()
		eng, err := engine.New(cfg, store)
		if err != nil {
			b.Fatalf("Failed to create engine: %v", err)
		}

		principal := &types.Principal{ID: "user123", Roles: []string{"user"}}
		resource := &types.Resource{
			Kind: "document",
			Attributes: map[string]interface{}{
				"ownerId": "user123",
				"editors": []string{"user456"},
				"public":  true,
			},
		}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			req := &types.CheckRequest{
				Principal: principal,
				Resource:  resource,
				Actions:   []string{"read"},
			}
			_, _ = eng.Check(context.Background(), req)
		}
	})
}

// BenchmarkWildcardMatching benchmarks wildcard parent role matching
func BenchmarkWildcardMatching(b *testing.B) {
	resolver, err := derived_roles.NewDerivedRolesResolver()
	if err != nil {
		b.Fatalf("Failed to create resolver: %v", err)
	}

	b.Run("ExactMatch", func(b *testing.B) {
		derivedRolesList := []*types.DerivedRole{
			{
				Name:        "role1",
				ParentRoles: []string{"user"},
				Condition:   "",
			},
		}

		principal := &types.Principal{ID: "user1", Roles: []string{"user"}}
		resource := &types.Resource{Kind: "document"}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = resolver.Resolve(principal, resource, derivedRolesList)
		}
	})

	b.Run("PrefixWildcard", func(b *testing.B) {
		derivedRolesList := []*types.DerivedRole{
			{
				Name:        "admin_role",
				ParentRoles: []string{"admin:*"},
				Condition:   "",
			},
		}

		principal := &types.Principal{ID: "user1", Roles: []string{"admin:read", "admin:write"}}
		resource := &types.Resource{Kind: "document"}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = resolver.Resolve(principal, resource, derivedRolesList)
		}
	})

	b.Run("SuffixWildcard", func(b *testing.B) {
		derivedRolesList := []*types.DerivedRole{
			{
				Name:        "writer",
				ParentRoles: []string{"*:write"},
				Condition:   "",
			},
		}

		principal := &types.Principal{ID: "user1", Roles: []string{"document:write", "report:write"}}
		resource := &types.Resource{Kind: "document"}

		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_, _ = resolver.Resolve(principal, resource, derivedRolesList)
		}
	})
}

// BenchmarkScalability benchmarks performance at different scales
func BenchmarkScalability(b *testing.B) {
	scales := []int{10, 50, 100}

	for _, scale := range scales {
		b.Run(fmt.Sprintf("Policies_%d", scale), func(b *testing.B) {
			resolver, err := derived_roles.NewDerivedRolesResolver()
			if err != nil {
				b.Fatalf("Failed to create resolver: %v", err)
			}

			// Create policy with N definitions
			derivedRolesList := make([]*types.DerivedRole, scale)
			for i := 0; i < scale; i++ {
				derivedRolesList[i] = &types.DerivedRole{
					Name:        fmt.Sprintf("role%d", i),
					ParentRoles: []string{"user"},
					Condition:   fmt.Sprintf("P.attr.level >= %d", i),
				}
			}

			principal := &types.Principal{
				ID:         "user1",
				Roles:      []string{"user"},
				Attributes: map[string]interface{}{"level": scale / 2},
			}
			resource := &types.Resource{Kind: "document"}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, _ = resolver.Resolve(principal, resource, derivedRolesList)
			}
		})
	}
}
