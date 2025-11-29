import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionEngine } from '../../../src/engine/decision-engine';
import type { ValidatedDerivedRolesPolicy, ValidatedResourcePolicy } from '../../../src/policy/schema';
import type { CheckRequest } from '../../../src/types';

describe('DerivedRoles Integration with DecisionEngine', () => {
  let engine: DecisionEngine;

  beforeEach(() => {
    engine = new DecisionEngine();
  });

  describe('Basic Integration', () => {
    it('should use derived roles in resource policy evaluation', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'document-derived-roles' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['delete'],
              effect: 'allow',
              derivedRoles: ['owner'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: { ownerId: 'user123' },
        },
        actions: ['delete'],
      };

      const result = engine.check(request);

      expect(result.results.delete.effect).toBe('allow');
    });

    it('should deny when derived role does not match', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'document-derived-roles' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['delete'],
              effect: 'allow',
              derivedRoles: ['owner'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: { ownerId: 'user456' }, // Different owner
        },
        actions: ['delete'],
      };

      const result = engine.check(request);

      expect(result.results.delete.effect).toBe('deny');
    });

    it('should combine multiple derived roles', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'document-derived-roles' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
            {
              name: 'editor',
              parentRoles: ['user'],
              condition: { expression: 'P.id in R.attr.editors' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['delete'],
              effect: 'allow',
              derivedRoles: ['owner'],
            },
            {
              actions: ['edit'],
              effect: 'allow',
              derivedRoles: ['editor', 'owner'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {
            ownerId: 'user456',
            editors: ['user123', 'user789'],
          },
        },
        actions: ['edit', 'delete'],
      };

      const result = engine.check(request);

      expect(result.results.edit.effect).toBe('allow'); // Editor can edit
      expect(result.results.delete.effect).toBe('deny'); // Only owner can delete
    });

    it('should work with wildcard parent roles', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'authenticated-roles' },
        spec: {
          definitions: [
            {
              name: 'authenticated',
              parentRoles: ['*'], // Any role
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              derivedRoles: ['authenticated'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['guest'], // Any role should work
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {},
        },
        actions: ['view'],
      };

      const result = engine.check(request);

      expect(result.results.view.effect).toBe('allow');
    });

    it('should work with prefix wildcard parent roles', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'admin-roles' },
        spec: {
          definitions: [
            {
              name: 'any_admin',
              parentRoles: ['admin:*'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['manage'],
              effect: 'allow',
              derivedRoles: ['any_admin'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['admin:read', 'user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {},
        },
        actions: ['manage'],
      };

      const result = engine.check(request);

      expect(result.results.manage.effect).toBe('allow');
    });

    it('should handle auxData in derived role conditions', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'time-based-roles' },
        spec: {
          definitions: [
            {
              name: 'business_hours_user',
              parentRoles: ['user'],
              condition: { expression: 'A.isBusinessHours' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['edit'],
              effect: 'allow',
              derivedRoles: ['business_hours_user'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {},
        },
        actions: ['edit'],
        auxData: { isBusinessHours: true },
      };

      const result = engine.check(request);

      expect(result.results.edit.effect).toBe('allow');
    });
  });

  describe('Combined Policies', () => {
    it('should combine base roles, derived roles, and principal policies', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'document-derived-roles' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['view'],
              effect: 'allow',
              roles: ['user'], // Base role
            },
            {
              actions: ['delete'],
              effect: 'allow',
              derivedRoles: ['owner'], // Derived role
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const ownerRequest: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: { ownerId: 'user123' },
        },
        actions: ['view', 'delete'],
      };

      const ownerResult = engine.check(ownerRequest);

      expect(ownerResult.results.view.effect).toBe('allow'); // Base role allows view
      expect(ownerResult.results.delete.effect).toBe('allow'); // Derived role allows delete

      const nonOwnerRequest: CheckRequest = {
        principal: {
          id: 'user456',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: { ownerId: 'user123' },
        },
        actions: ['view', 'delete'],
      };

      const nonOwnerResult = engine.check(nonOwnerRequest);

      expect(nonOwnerResult.results.view.effect).toBe('allow'); // Base role allows view
      expect(nonOwnerResult.results.delete.effect).toBe('deny'); // Not owner, can't delete
    });

    it('should handle multiple derived roles policies', () => {
      const derivedRolesPolicy1: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'ownership-roles' },
        spec: {
          definitions: [
            {
              name: 'owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id' },
            },
          ],
        },
      };

      const derivedRolesPolicy2: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'collaboration-roles' },
        spec: {
          definitions: [
            {
              name: 'collaborator',
              parentRoles: ['user'],
              condition: { expression: 'P.id in R.attr.collaborators' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['edit'],
              effect: 'allow',
              derivedRoles: ['owner', 'collaborator'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy1, derivedRolesPolicy2]);
      engine.loadResourcePolicies([resourcePolicy]);

      const collaboratorRequest: CheckRequest = {
        principal: {
          id: 'user456',
          roles: ['user'],
          attributes: {},
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {
            ownerId: 'user123',
            collaborators: ['user456', 'user789'],
          },
        },
        actions: ['edit'],
      };

      const result = engine.check(collaboratorRequest);

      expect(result.results.edit.effect).toBe('allow');
    });

    it('should apply deny rules correctly with derived roles', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'document-derived-roles' },
        spec: {
          definitions: [
            {
              name: 'suspended_owner',
              parentRoles: ['user'],
              condition: { expression: 'R.attr.ownerId == P.id && P.attr.suspended' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['edit'],
              effect: 'allow',
              roles: ['user'],
            },
            {
              actions: ['edit'],
              effect: 'deny',
              derivedRoles: ['suspended_owner'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: { suspended: true },
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: { ownerId: 'user123' },
        },
        actions: ['edit'],
      };

      const result = engine.check(request);

      expect(result.results.edit.effect).toBe('deny'); // Deny rule takes precedence
    });
  });

  describe('Scoped Derived Roles', () => {
    it('should respect scope in derived roles policies', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: {
          name: 'scoped-derived-roles',
          scope: 'acme.corp.engineering',
        },
        spec: {
          definitions: [
            {
              name: 'team_lead',
              parentRoles: ['engineer'],
              condition: { expression: 'P.attr.isTeamLead' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'project-policy',
          scope: 'acme.corp.engineering',
        },
        spec: {
          resource: 'project',
          rules: [
            {
              actions: ['approve'],
              effect: 'allow',
              derivedRoles: ['team_lead'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['engineer'],
          attributes: { isTeamLead: true },
        },
        resource: {
          kind: 'project',
          id: 'proj1',
          attributes: { scope: 'acme.corp.engineering' },
        },
        actions: ['approve'],
      };

      const result = engine.check(request);

      expect(result.results.approve.effect).toBe('allow');
    });

    it.skip('should not apply derived roles from different scopes [TODO: Scope Filtering]', () => {
      // NOTE: Scope filtering for derived roles is not yet implemented in basic DecisionEngine.
      // This would require filtering derived roles based on scope compatibility during resolution.
      // Currently all derived roles are evaluated regardless of scope metadata.
      // TODO: Implement scope filtering in DerivedRolesResolver.resolve() when scope support is added.

      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: {
          name: 'engineering-derived-roles',
          scope: 'acme.corp.engineering',
        },
        spec: {
          definitions: [
            {
              name: 'team_lead',
              parentRoles: ['engineer'],
              condition: { expression: 'true' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'sales-policy',
          scope: 'acme.corp.sales', // Different scope
        },
        spec: {
          resource: 'lead',
          rules: [
            {
              actions: ['manage'],
              effect: 'allow',
              derivedRoles: ['team_lead'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['engineer'],
          attributes: {},
        },
        resource: {
          kind: 'lead',
          id: 'lead1',
          attributes: { scope: 'acme.corp.sales' },
        },
        actions: ['manage'],
      };

      const result = engine.check(request);

      // Should deny because derived role is from different scope
      expect(result.results.manage.effect).toBe('deny');
    });

    it('should apply hierarchical scopes correctly', () => {
      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: {
          name: 'corp-derived-roles',
          scope: 'acme.corp',
        },
        spec: {
          definitions: [
            {
              name: 'manager',
              parentRoles: ['employee'],
              condition: { expression: 'P.attr.isManager' },
            },
          ],
        },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: {
          name: 'resource-policy',
          scope: 'acme.corp.engineering', // Child scope
        },
        spec: {
          resource: 'resource',
          rules: [
            {
              actions: ['access'],
              effect: 'allow',
              derivedRoles: ['manager'],
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['employee'],
          attributes: { isManager: true },
        },
        resource: {
          kind: 'resource',
          id: 'res1',
          attributes: { scope: 'acme.corp.engineering' },
        },
        actions: ['access'],
      };

      const result = engine.check(request);

      // Should allow because parent scope applies to child scope
      expect(result.results.access.effect).toBe('allow');
    });
  });

  describe('Performance', () => {
    it('should handle multiple derived roles efficiently', () => {
      const definitions = Array.from({ length: 50 }, (_, i) => ({
        name: `role${i}`,
        parentRoles: ['user'],
        condition: { expression: `P.attr.level >= ${i}` },
      }));

      const derivedRolesPolicy: ValidatedDerivedRolesPolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'DerivedRoles',
        metadata: { name: 'many-roles' },
        spec: { definitions },
      };

      const resourcePolicy: ValidatedResourcePolicy = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'document-policy' },
        spec: {
          resource: 'document',
          rules: [
            {
              actions: ['access'],
              effect: 'allow',
              derivedRoles: definitions.map(d => d.name),
            },
          ],
        },
      };

      engine.loadDerivedRolesPolicies([derivedRolesPolicy]);
      engine.loadResourcePolicies([resourcePolicy]);

      const startTime = performance.now();

      const request: CheckRequest = {
        principal: {
          id: 'user123',
          roles: ['user'],
          attributes: { level: 25 },
        },
        resource: {
          kind: 'document',
          id: 'doc1',
          attributes: {},
        },
        actions: ['access'],
      };

      engine.check(request);

      const duration = performance.now() - startTime;

      // Should complete in < 15ms (realistic target for 50 derived roles with CEL evaluation)
      // Note: Includes CEL parsing, condition evaluation, and parent role matching
      expect(duration).toBeLessThan(15);
    });
  });
});
