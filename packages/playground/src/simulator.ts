/**
 * Policy Simulator
 *
 * Interactive policy simulation engine for testing and debugging
 * authorization policies without affecting production systems.
 *
 * @module @authz-engine/playground/simulator
 */

import { parse as parseYaml } from 'yaml';
import type {
  CheckRequest,
  CheckResponse,
  ActionResult,
  Principal,
  Resource,
  Effect,
  PolicyRule,
} from '@authz-engine/core';
import { PolicyParser, DecisionEngine, CelEvaluator } from '@authz-engine/core';
import type { ValidatedResourcePolicy, ValidatedDerivedRolesPolicy } from '@authz-engine/core';

/**
 * Detailed rule match information for explanation
 */
export interface RuleMatch {
  /** Policy name containing the rule */
  policyName: string;
  /** Rule name or index */
  ruleName: string;
  /** Actions the rule applies to */
  actions: string[];
  /** Effect of the rule */
  effect: Effect;
  /** Roles required (if any) */
  roles?: string[];
  /** Derived roles required (if any) */
  derivedRoles?: string[];
  /** Condition expression (if any) */
  condition?: string;
  /** Whether the rule matched */
  matched: boolean;
  /** Reason for match/no-match */
  reason: string;
}

/**
 * Detailed explanation of a decision
 */
export interface DecisionExplanation {
  /** The request that was evaluated */
  request: CheckRequest;
  /** The response from evaluation */
  response: CheckResponse;
  /** Derived roles computed for the principal */
  derivedRoles: string[];
  /** All rules that were evaluated */
  rulesEvaluated: RuleMatch[];
  /** Step-by-step trace of evaluation */
  trace: string[];
  /** Suggestions for policy improvements */
  suggestions: string[];
}

/**
 * What-if analysis result
 */
export interface WhatIfResult {
  /** Original decision */
  original: CheckResponse;
  /** Decision with proposed changes */
  modified: CheckResponse;
  /** Whether the decision changed */
  changed: boolean;
  /** Description of what changed */
  changes: string[];
}

/**
 * Generated test case
 */
export interface GeneratedTestCase {
  /** Test case name */
  name: string;
  /** Test case description */
  description: string;
  /** The request to test */
  request: CheckRequest;
  /** Expected result for each action */
  expectedResults: Record<string, Effect>;
  /** Tags for categorization */
  tags: string[];
}

/**
 * Policy Simulator Configuration
 */
export interface SimulatorConfig {
  /** Enable verbose tracing */
  verbose?: boolean;
  /** Maximum depth for what-if analysis */
  maxWhatIfDepth?: number;
}

/**
 * Policy Simulator
 *
 * Provides interactive simulation, explanation, and testing
 * capabilities for authorization policies.
 */
export class PolicySimulator {
  private readonly parser: PolicyParser;
  private readonly engine: DecisionEngine;
  private readonly celEvaluator: CelEvaluator;
  private resourcePolicies: ValidatedResourcePolicy[] = [];
  private derivedRolesPolicies: ValidatedDerivedRolesPolicy[] = [];
  private readonly config: SimulatorConfig;
  private lastRequest?: CheckRequest;
  private lastResponse?: CheckResponse;
  private lastExplanation?: DecisionExplanation;

  constructor(config: SimulatorConfig = {}) {
    this.parser = new PolicyParser();
    this.engine = new DecisionEngine();
    this.celEvaluator = new CelEvaluator();
    this.config = {
      verbose: config.verbose ?? false,
      maxWhatIfDepth: config.maxWhatIfDepth ?? 10,
    };
  }

  /**
   * Load a policy from YAML string
   *
   * @param yaml - YAML policy content
   * @returns Information about the loaded policy
   */
  loadPolicy(yaml: string): { type: string; name: string; resource?: string } {
    const policy = this.parser.parseYaml(yaml);

    if (policy.kind === 'ResourcePolicy') {
      const resourcePolicy = policy as ValidatedResourcePolicy;
      this.resourcePolicies.push(resourcePolicy);
      this.engine.loadResourcePolicies([resourcePolicy]);
      return {
        type: 'ResourcePolicy',
        name: resourcePolicy.metadata.name,
        resource: resourcePolicy.spec.resource,
      };
    }

    if (policy.kind === 'DerivedRoles') {
      const derivedPolicy = policy as ValidatedDerivedRolesPolicy;
      this.derivedRolesPolicies.push(derivedPolicy);
      this.engine.loadDerivedRolesPolicies([derivedPolicy]);
      return {
        type: 'DerivedRoles',
        name: derivedPolicy.metadata.name,
      };
    }

    throw new Error(`Unsupported policy kind: ${policy.kind}`);
  }

  /**
   * Load multiple policies from YAML string (supports multiple documents)
   *
   * @param yaml - YAML content with one or more policies
   * @returns Array of loaded policy information
   */
  loadPolicies(yaml: string): Array<{ type: string; name: string; resource?: string }> {
    const results: Array<{ type: string; name: string; resource?: string }> = [];

    // Split by YAML document separator
    const documents = yaml.split(/^---\s*$/m).filter((doc) => doc.trim());

    for (const doc of documents) {
      if (doc.trim()) {
        results.push(this.loadPolicy(doc));
      }
    }

    return results;
  }

  /**
   * Clear all loaded policies
   */
  clearPolicies(): void {
    this.resourcePolicies = [];
    this.derivedRolesPolicies = [];
    this.engine.clearPolicies();
    this.lastRequest = undefined;
    this.lastResponse = undefined;
    this.lastExplanation = undefined;
  }

  /**
   * Run a simulation with the given request
   *
   * @param request - The check request to simulate
   * @returns The check response
   */
  simulate(request: CheckRequest): CheckResponse {
    this.lastRequest = request;
    this.lastResponse = this.engine.check(request);
    this.lastExplanation = undefined; // Clear cached explanation
    return this.lastResponse;
  }

  /**
   * Get a detailed explanation of the last decision
   *
   * @param request - Optional request (uses last request if not provided)
   * @returns Detailed explanation of the decision
   */
  explain(request?: CheckRequest): DecisionExplanation {
    const req = request ?? this.lastRequest;
    if (!req) {
      throw new Error('No request to explain. Call simulate() first or provide a request.');
    }

    // Run simulation if needed
    if (!this.lastResponse || request) {
      this.simulate(req);
    }

    // Build explanation
    const explanation = this.buildExplanation(req, this.lastResponse!);
    this.lastExplanation = explanation;
    return explanation;
  }

  /**
   * Test policy changes with what-if analysis
   *
   * @param changes - Changes to apply for analysis
   * @returns What-if analysis result
   */
  whatIf(changes: {
    /** Modified principal attributes */
    principal?: Partial<Principal>;
    /** Modified resource attributes */
    resource?: Partial<Resource>;
    /** Modified actions */
    actions?: string[];
    /** Additional aux data */
    auxData?: Record<string, unknown>;
  }): WhatIfResult {
    if (!this.lastRequest) {
      throw new Error('No request for what-if analysis. Call simulate() first.');
    }

    const originalResponse = this.lastResponse!;

    // Build modified request
    const modifiedRequest: CheckRequest = {
      ...this.lastRequest,
      principal: {
        ...this.lastRequest.principal,
        ...changes.principal,
        attributes: {
          ...this.lastRequest.principal.attributes,
          ...(changes.principal?.attributes ?? {}),
        },
        roles: changes.principal?.roles ?? this.lastRequest.principal.roles,
      },
      resource: {
        ...this.lastRequest.resource,
        ...changes.resource,
        attributes: {
          ...this.lastRequest.resource.attributes,
          ...(changes.resource?.attributes ?? {}),
        },
      },
      actions: changes.actions ?? this.lastRequest.actions,
      auxData: {
        ...this.lastRequest.auxData,
        ...changes.auxData,
      },
    };

    // Run modified simulation
    const modifiedResponse = this.engine.check(modifiedRequest);

    // Compare results
    const changeDescriptions: string[] = [];
    let changed = false;

    for (const action of new Set([...this.lastRequest.actions, ...modifiedRequest.actions])) {
      const originalResult = originalResponse.results[action];
      const modifiedResult = modifiedResponse.results[action];

      if (!originalResult && modifiedResult) {
        changed = true;
        changeDescriptions.push(`Action '${action}': NEW -> ${modifiedResult.effect}`);
      } else if (originalResult && !modifiedResult) {
        changed = true;
        changeDescriptions.push(`Action '${action}': ${originalResult.effect} -> REMOVED`);
      } else if (originalResult?.effect !== modifiedResult?.effect) {
        changed = true;
        changeDescriptions.push(
          `Action '${action}': ${originalResult.effect} -> ${modifiedResult.effect}`
        );
      }
    }

    return {
      original: originalResponse,
      modified: modifiedResponse,
      changed,
      changes: changeDescriptions,
    };
  }

  /**
   * Find all rules that match the current request
   *
   * @param request - Optional request (uses last request if not provided)
   * @returns Array of matching rule information
   */
  findMatchingRules(request?: CheckRequest): RuleMatch[] {
    const req = request ?? this.lastRequest;
    if (!req) {
      throw new Error('No request to analyze. Call simulate() first or provide a request.');
    }

    const matches: RuleMatch[] = [];

    // Get derived roles
    const derivedRoles = this.computeDerivedRoles(req.principal, req.resource, req.auxData);

    // Check each policy
    for (const policy of this.resourcePolicies) {
      if (policy.spec.resource !== req.resource.kind) {
        continue;
      }

      for (let i = 0; i < policy.spec.rules.length; i++) {
        const rule = policy.spec.rules[i];
        const ruleMatch = this.evaluateRuleMatch(
          rule,
          req,
          derivedRoles,
          policy.metadata.name,
          i
        );
        matches.push(ruleMatch);
      }
    }

    return matches;
  }

  /**
   * Auto-generate test cases based on loaded policies
   *
   * @returns Array of generated test cases
   */
  generateTestCases(): GeneratedTestCase[] {
    const testCases: GeneratedTestCase[] = [];

    for (const policy of this.resourcePolicies) {
      const resourceKind = policy.spec.resource;

      // Generate test cases for each rule
      for (let i = 0; i < policy.spec.rules.length; i++) {
        const rule = policy.spec.rules[i];
        const ruleName = rule.name ?? `rule-${i}`;

        // Test case for when rule should allow
        if (rule.effect === 'allow') {
          testCases.push(
            this.generateAllowTestCase(policy, rule, ruleName, resourceKind)
          );
        }

        // Test case for when rule should deny
        if (rule.effect === 'deny') {
          testCases.push(
            this.generateDenyTestCase(policy, rule, ruleName, resourceKind)
          );
        }

        // Edge case: missing role
        if (rule.roles && rule.roles.length > 0) {
          testCases.push(
            this.generateMissingRoleTestCase(policy, rule, ruleName, resourceKind)
          );
        }
      }

      // Generate default deny test case
      testCases.push(this.generateDefaultDenyTestCase(policy, resourceKind));
    }

    return testCases;
  }

  /**
   * Get statistics about loaded policies
   */
  getStats(): {
    resourcePolicies: number;
    derivedRolesPolicies: number;
    totalRules: number;
    resources: string[];
    derivedRoles: string[];
  } {
    const totalRules = this.resourcePolicies.reduce(
      (sum, p) => sum + p.spec.rules.length,
      0
    );

    const derivedRoleNames = this.derivedRolesPolicies.flatMap(
      (p) => p.spec.definitions.map((d) => d.name)
    );

    return {
      resourcePolicies: this.resourcePolicies.length,
      derivedRolesPolicies: this.derivedRolesPolicies.length,
      totalRules,
      resources: this.resourcePolicies.map((p) => p.spec.resource),
      derivedRoles: derivedRoleNames,
    };
  }

  /**
   * Get the last request
   */
  getLastRequest(): CheckRequest | undefined {
    return this.lastRequest;
  }

  /**
   * Get the last response
   */
  getLastResponse(): CheckResponse | undefined {
    return this.lastResponse;
  }

  // Private helper methods

  private buildExplanation(
    request: CheckRequest,
    response: CheckResponse
  ): DecisionExplanation {
    const trace: string[] = [];
    const suggestions: string[] = [];

    trace.push(`Evaluating request for principal: ${request.principal.id}`);
    trace.push(`Principal roles: [${request.principal.roles.join(', ')}]`);
    trace.push(`Resource: ${request.resource.kind}:${request.resource.id}`);
    trace.push(`Actions: [${request.actions.join(', ')}]`);

    // Compute derived roles
    const derivedRoles = this.computeDerivedRoles(
      request.principal,
      request.resource,
      request.auxData
    );

    if (derivedRoles.length > 0) {
      trace.push(`Derived roles computed: [${derivedRoles.join(', ')}]`);
    } else {
      trace.push('No derived roles matched');
    }

    // Find matching policies
    const matchingPolicies = this.resourcePolicies.filter(
      (p) => p.spec.resource === request.resource.kind
    );

    if (matchingPolicies.length === 0) {
      trace.push(`No policies found for resource type: ${request.resource.kind}`);
      suggestions.push(
        `Create a ResourcePolicy for resource type '${request.resource.kind}'`
      );
    } else {
      trace.push(`Found ${matchingPolicies.length} policy(ies) for resource type`);
    }

    // Evaluate rules
    const rulesEvaluated = this.findMatchingRules(request);

    for (const rule of rulesEvaluated) {
      if (rule.matched) {
        trace.push(`MATCH: ${rule.policyName}/${rule.ruleName} -> ${rule.effect}`);
      } else {
        trace.push(`NO MATCH: ${rule.policyName}/${rule.ruleName} - ${rule.reason}`);
      }
    }

    // Final decisions
    for (const action of request.actions) {
      const result = response.results[action];
      trace.push(`Final decision for '${action}': ${result.effect} (${result.policy})`);
    }

    // Generate suggestions
    const denyActions = Object.entries(response.results)
      .filter(([, r]) => r.effect === 'deny' && r.policy === 'default-deny')
      .map(([a]) => a);

    if (denyActions.length > 0) {
      suggestions.push(
        `Actions [${denyActions.join(', ')}] denied by default. ` +
        `Add explicit rules to allow these actions.`
      );
    }

    return {
      request,
      response,
      derivedRoles,
      rulesEvaluated,
      trace,
      suggestions,
    };
  }

  private computeDerivedRoles(
    principal: Principal,
    resource: Resource,
    auxData?: Record<string, unknown>
  ): string[] {
    const derivedRoles: string[] = [];

    for (const policy of this.derivedRolesPolicies) {
      for (const definition of policy.spec.definitions) {
        const hasParentRole =
          definition.parentRoles.length === 0 ||
          definition.parentRoles.some((role) => principal.roles.includes(role));

        if (!hasParentRole) {
          continue;
        }

        const result = this.celEvaluator.evaluateBoolean(definition.condition.expression, {
          principal,
          resource,
          auxData,
        });

        if (result) {
          derivedRoles.push(definition.name);
        }
      }
    }

    return derivedRoles;
  }

  private evaluateRuleMatch(
    rule: PolicyRule,
    request: CheckRequest,
    derivedRoles: string[],
    policyName: string,
    ruleIndex: number
  ): RuleMatch {
    const ruleName = rule.name ?? `rule-${ruleIndex}`;
    const allRoles = [...request.principal.roles, ...derivedRoles];

    // Check action match
    const actionMatches = request.actions.some(
      (action) => rule.actions.includes(action) || rule.actions.includes('*')
    );

    if (!actionMatches) {
      return {
        policyName,
        ruleName,
        actions: rule.actions,
        effect: rule.effect,
        roles: rule.roles,
        derivedRoles: rule.derivedRoles,
        condition: rule.condition?.expression,
        matched: false,
        reason: `Actions [${request.actions.join(', ')}] not in rule actions [${rule.actions.join(', ')}]`,
      };
    }

    // Check role match
    if (rule.roles && rule.roles.length > 0) {
      const hasRole = rule.roles.some((role) => allRoles.includes(role));
      if (!hasRole) {
        return {
          policyName,
          ruleName,
          actions: rule.actions,
          effect: rule.effect,
          roles: rule.roles,
          derivedRoles: rule.derivedRoles,
          condition: rule.condition?.expression,
          matched: false,
          reason: `Principal roles [${allRoles.join(', ')}] do not include required roles [${rule.roles.join(', ')}]`,
        };
      }
    }

    // Check derived role match
    if (rule.derivedRoles && rule.derivedRoles.length > 0) {
      const hasDerivedRole = rule.derivedRoles.some((role) => derivedRoles.includes(role));
      if (!hasDerivedRole) {
        return {
          policyName,
          ruleName,
          actions: rule.actions,
          effect: rule.effect,
          roles: rule.roles,
          derivedRoles: rule.derivedRoles,
          condition: rule.condition?.expression,
          matched: false,
          reason: `Derived roles [${derivedRoles.join(', ')}] do not include required [${rule.derivedRoles.join(', ')}]`,
        };
      }
    }

    // Check condition
    if (rule.condition) {
      const result = this.celEvaluator.evaluateBoolean(rule.condition.expression, {
        principal: request.principal,
        resource: request.resource,
        auxData: request.auxData,
      });

      if (!result) {
        return {
          policyName,
          ruleName,
          actions: rule.actions,
          effect: rule.effect,
          roles: rule.roles,
          derivedRoles: rule.derivedRoles,
          condition: rule.condition.expression,
          matched: false,
          reason: `Condition '${rule.condition.expression}' evaluated to false`,
        };
      }
    }

    // All checks passed
    return {
      policyName,
      ruleName,
      actions: rule.actions,
      effect: rule.effect,
      roles: rule.roles,
      derivedRoles: rule.derivedRoles,
      condition: rule.condition?.expression,
      matched: true,
      reason: 'All conditions satisfied',
    };
  }

  private generateAllowTestCase(
    policy: ValidatedResourcePolicy,
    rule: PolicyRule,
    ruleName: string,
    resourceKind: string
  ): GeneratedTestCase {
    const roles = rule.roles ?? ['user'];
    const action = rule.actions[0] === '*' ? 'read' : rule.actions[0];

    return {
      name: `${policy.metadata.name}_${ruleName}_allow`,
      description: `Test that ${ruleName} allows ${action} for ${roles.join(', ')}`,
      request: {
        principal: {
          id: 'test-user',
          roles,
          attributes: {},
        },
        resource: {
          kind: resourceKind,
          id: 'test-resource',
          attributes: {},
        },
        actions: [action],
      },
      expectedResults: { [action]: 'allow' },
      tags: ['allow', ruleName, policy.metadata.name],
    };
  }

  private generateDenyTestCase(
    policy: ValidatedResourcePolicy,
    rule: PolicyRule,
    ruleName: string,
    resourceKind: string
  ): GeneratedTestCase {
    const roles = rule.roles ?? ['user'];
    const action = rule.actions[0] === '*' ? 'delete' : rule.actions[0];

    return {
      name: `${policy.metadata.name}_${ruleName}_deny`,
      description: `Test that ${ruleName} denies ${action} for ${roles.join(', ')}`,
      request: {
        principal: {
          id: 'test-user',
          roles,
          attributes: {},
        },
        resource: {
          kind: resourceKind,
          id: 'test-resource',
          attributes: {},
        },
        actions: [action],
      },
      expectedResults: { [action]: 'deny' },
      tags: ['deny', ruleName, policy.metadata.name],
    };
  }

  private generateMissingRoleTestCase(
    policy: ValidatedResourcePolicy,
    rule: PolicyRule,
    ruleName: string,
    resourceKind: string
  ): GeneratedTestCase {
    const action = rule.actions[0] === '*' ? 'read' : rule.actions[0];

    return {
      name: `${policy.metadata.name}_${ruleName}_missing_role`,
      description: `Test that ${ruleName} denies when required role is missing`,
      request: {
        principal: {
          id: 'test-user',
          roles: ['guest'], // Role that doesn't match
          attributes: {},
        },
        resource: {
          kind: resourceKind,
          id: 'test-resource',
          attributes: {},
        },
        actions: [action],
      },
      expectedResults: { [action]: 'deny' },
      tags: ['deny', 'missing-role', ruleName, policy.metadata.name],
    };
  }

  private generateDefaultDenyTestCase(
    policy: ValidatedResourcePolicy,
    resourceKind: string
  ): GeneratedTestCase {
    return {
      name: `${policy.metadata.name}_default_deny`,
      description: `Test that unknown actions are denied by default`,
      request: {
        principal: {
          id: 'test-user',
          roles: ['guest'],
          attributes: {},
        },
        resource: {
          kind: resourceKind,
          id: 'test-resource',
          attributes: {},
        },
        actions: ['unknown-action'],
      },
      expectedResults: { 'unknown-action': 'deny' },
      tags: ['deny', 'default', policy.metadata.name],
    };
  }
}

export { PolicySimulator as default };
