import { describe, it, expect } from 'vitest';
import { PolicyParser, PolicyParseError } from '../../../src/policy/parser';

describe('PolicyParser', () => {
  const parser = new PolicyParser();

  describe('parseYaml', () => {
    it('should parse a valid resource policy', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: test-policy
spec:
  resource: subscription
  rules:
    - actions: [create, read]
      effect: allow
      roles: [user]
`;

      const result = parser.parseYaml(yaml);

      expect(result.kind).toBe('ResourcePolicy');
      expect(result.metadata.name).toBe('test-policy');
      if (result.kind === 'ResourcePolicy') {
        expect(result.spec.resource).toBe('subscription');
        expect(result.spec.rules).toHaveLength(1);
        expect(result.spec.rules[0].actions).toEqual(['create', 'read']);
      }
    });

    it('should parse a policy with conditions', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: owner-policy
spec:
  resource: avatar
  rules:
    - actions: [edit, delete]
      effect: allow
      roles: [user]
      condition:
        expression: resource.ownerId == principal.id
`;

      const result = parser.parseYaml(yaml);

      expect(result.kind).toBe('ResourcePolicy');
      if (result.kind === 'ResourcePolicy') {
        expect(result.spec.rules[0].condition?.expression).toBe('resource.ownerId == principal.id');
      }
    });

    it('should throw on invalid YAML', () => {
      const yaml = `
not: valid: yaml: here
`;

      expect(() => parser.parseYaml(yaml)).toThrow(PolicyParseError);
    });

    it('should throw on missing required fields', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: ResourcePolicy
metadata:
  name: incomplete-policy
spec:
  resource: test
`;

      expect(() => parser.parseYaml(yaml)).toThrow(PolicyParseError);
    });
  });

  describe('parseDerivedRolesPolicy', () => {
    it('should parse derived roles', () => {
      const yaml = `
apiVersion: authz.engine/v1
kind: DerivedRoles
metadata:
  name: connex-roles
spec:
  definitions:
    - name: owner
      parentRoles: [user]
      condition:
        expression: resource.ownerId == principal.id
    - name: admin
      parentRoles: [user]
      condition:
        expression: principal.roles.includes("admin")
`;

      const parsed = parser.parseYaml(yaml);
      const result = parser.parseDerivedRolesPolicy(parsed);

      expect(result.kind).toBe('DerivedRoles');
      expect(result.spec.definitions).toHaveLength(2);
      expect(result.spec.definitions[0].name).toBe('owner');
      expect(result.spec.definitions[1].name).toBe('admin');
    });
  });

  describe('parseJson', () => {
    it('should parse JSON policy', () => {
      const json = JSON.stringify({
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'json-policy' },
        spec: {
          resource: 'chat',
          rules: [
            { actions: ['send'], effect: 'allow', roles: ['user'] }
          ]
        }
      });

      const result = parser.parseJson(json);

      expect(result.kind).toBe('ResourcePolicy');
      expect(result.metadata.name).toBe('json-policy');
    });
  });

  describe('isPolicy', () => {
    it('should return true for valid policy structure', () => {
      const data = {
        apiVersion: 'authz.engine/v1',
        kind: 'ResourcePolicy',
        metadata: { name: 'test' },
        spec: {}
      };

      expect(parser.isPolicy(data)).toBe(true);
    });

    it('should return false for non-policy objects', () => {
      expect(parser.isPolicy(null)).toBe(false);
      expect(parser.isPolicy({})).toBe(false);
      expect(parser.isPolicy({ apiVersion: 'v1' })).toBe(false);
    });
  });
});
