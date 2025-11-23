/**
 * ADVISOR Agent - LLM-Powered Explanations & Recommendations
 *
 * Responsibilities:
 * - Generate natural language explanations for authorization decisions
 * - Provide "path to allow" recommendations
 * - Answer natural language policy questions
 * - Generate policy documentation
 * - Assist with policy debugging
 * - Policy optimization recommendations
 * - Least privilege suggestions
 * - Role consolidation analysis
 * - Compliance mapping (GDPR, SOC2, HIPAA)
 * - Security hardening recommendations
 */

import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  DecisionExplanation,
  ExplanationFactor,
  PathToAllow,
  DecisionRecord,
} from '../types/agent.types.js';
import type { CheckRequest, CheckResponse, ActionResult } from '@authz-engine/core';

/**
 * Helper to check if an ActionResult is allowed
 */
function isAllowed(result: ActionResult | undefined): boolean {
  return result?.effect === 'allow';
}

// =============================================================================
// Compliance Framework Types
// =============================================================================

export type ComplianceFramework = 'GDPR' | 'SOC2' | 'HIPAA' | 'PCI_DSS' | 'ISO27001';

export interface ComplianceRequirement {
  id: string;
  framework: ComplianceFramework;
  control: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ComplianceMapping {
  framework: ComplianceFramework;
  requirements: ComplianceRequirement[];
  coverage: number; // 0-1 percentage
  gaps: ComplianceGap[];
  recommendations: string[];
}

export interface ComplianceGap {
  requirementId: string;
  control: string;
  description: string;
  remediation: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// =============================================================================
// Policy Recommendation Types
// =============================================================================

export interface PolicyRecommendation {
  id: string;
  type: PolicyRecommendationType;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  suggestedChange?: string;
  affectedPolicies: string[];
  compliance?: ComplianceFramework[];
}

export type PolicyRecommendationType =
  | 'overly_permissive'
  | 'missing_condition'
  | 'redundant_rule'
  | 'privilege_escalation_risk'
  | 'unused_permission'
  | 'inconsistent_naming'
  | 'missing_audit'
  | 'role_consolidation'
  | 'least_privilege_violation'
  | 'security_hardening';

// =============================================================================
// Least Privilege Types
// =============================================================================

export interface LeastPrivilegeAnalysis {
  principalId: string;
  grantedPermissions: string[];
  usedPermissions: string[];
  unusedPermissions: string[];
  overPrivilegedScore: number; // 0-1, higher = more over-privileged
  recommendations: LeastPrivilegeRecommendation[];
  analysisDate: Date;
}

export interface LeastPrivilegeRecommendation {
  permission: string;
  reason: string;
  suggestedAction: 'remove' | 'review' | 'time_bound' | 'conditional';
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  lastUsed?: Date;
}

// =============================================================================
// Role Consolidation Types
// =============================================================================

export interface RoleConsolidationAnalysis {
  analyzedRoles: string[];
  consolidationOpportunities: RoleConsolidationOpportunity[];
  redundantRoles: RedundantRole[];
  suggestedRoleHierarchy: RoleHierarchyNode[];
  estimatedReduction: number; // percentage of roles that can be consolidated
  analysisDate: Date;
}

export interface RoleConsolidationOpportunity {
  sourceRoles: string[];
  targetRole: string;
  permissionOverlap: number; // 0-1 percentage
  affectedPrincipals: number;
  rationale: string;
  effort: 'low' | 'medium' | 'high';
}

export interface RedundantRole {
  roleName: string;
  duplicateOf: string;
  permissionSimilarity: number; // 0-1 percentage
  recommendation: string;
}

export interface RoleHierarchyNode {
  roleName: string;
  inheritsFrom: string[];
  permissions: string[];
  children: string[];
}

// =============================================================================
// Security Posture Types
// =============================================================================

export interface SecurityPostureAssessment {
  overallScore: number; // 0-100
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  categories: SecurityCategory[];
  findings: SecurityFinding[];
  hardeningRecommendations: HardeningRecommendation[];
  assessmentDate: Date;
}

export interface SecurityCategory {
  name: string;
  score: number; // 0-100
  weight: number; // importance weight for overall score
  findings: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface SecurityFinding {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string;
  remediation: string;
  compliance?: ComplianceFramework[];
}

export interface HardeningRecommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  implementation: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  securityImpact: number; // 1-10 improvement score
}

export interface AdvisorConfig {
  llmProvider: 'openai' | 'anthropic' | 'local';
  llmModel: string;
  apiKey?: string;
  enableNaturalLanguage: boolean;
  maxExplanationLength: number;
  cacheExplanations: boolean;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// =============================================================================
// Compliance Framework Definitions
// =============================================================================

const COMPLIANCE_REQUIREMENTS: Record<ComplianceFramework, ComplianceRequirement[]> = {
  GDPR: [
    { id: 'GDPR-5.1.f', framework: 'GDPR', control: 'Integrity and Confidentiality', description: 'Personal data must be processed securely with appropriate technical measures', severity: 'critical' },
    { id: 'GDPR-25', framework: 'GDPR', control: 'Data Protection by Design', description: 'Implement data protection principles by design and default', severity: 'high' },
    { id: 'GDPR-32', framework: 'GDPR', control: 'Security of Processing', description: 'Implement appropriate technical and organizational measures', severity: 'critical' },
    { id: 'GDPR-33', framework: 'GDPR', control: 'Data Breach Notification', description: 'Notify supervisory authority within 72 hours of breach', severity: 'critical' },
    { id: 'GDPR-30', framework: 'GDPR', control: 'Records of Processing', description: 'Maintain records of processing activities', severity: 'medium' },
  ],
  SOC2: [
    { id: 'SOC2-CC6.1', framework: 'SOC2', control: 'Logical Access Security', description: 'Restrict logical access to authorized users', severity: 'critical' },
    { id: 'SOC2-CC6.2', framework: 'SOC2', control: 'Access Provisioning', description: 'Implement formal access provisioning procedures', severity: 'high' },
    { id: 'SOC2-CC6.3', framework: 'SOC2', control: 'Access Removal', description: 'Remove access when no longer required', severity: 'high' },
    { id: 'SOC2-CC6.6', framework: 'SOC2', control: 'Segregation of Duties', description: 'Implement segregation of duties', severity: 'high' },
    { id: 'SOC2-CC7.2', framework: 'SOC2', control: 'Security Monitoring', description: 'Monitor system for anomalies and security events', severity: 'critical' },
  ],
  HIPAA: [
    { id: 'HIPAA-164.312(a)(1)', framework: 'HIPAA', control: 'Access Control', description: 'Implement technical policies and procedures for access control', severity: 'critical' },
    { id: 'HIPAA-164.312(b)', framework: 'HIPAA', control: 'Audit Controls', description: 'Implement hardware, software, and procedural mechanisms for audit', severity: 'critical' },
    { id: 'HIPAA-164.312(c)(1)', framework: 'HIPAA', control: 'Integrity', description: 'Implement policies and procedures to protect ePHI', severity: 'critical' },
    { id: 'HIPAA-164.312(d)', framework: 'HIPAA', control: 'Person Authentication', description: 'Implement procedures to verify person seeking access', severity: 'high' },
    { id: 'HIPAA-164.308(a)(4)', framework: 'HIPAA', control: 'Access Management', description: 'Implement policies and procedures for authorizing access', severity: 'high' },
  ],
  PCI_DSS: [
    { id: 'PCI-7.1', framework: 'PCI_DSS', control: 'Access Control', description: 'Limit access to system components based on need to know', severity: 'critical' },
    { id: 'PCI-7.2', framework: 'PCI_DSS', control: 'Access Assignment', description: 'Establish access control system based on need to know', severity: 'high' },
    { id: 'PCI-8.1', framework: 'PCI_DSS', control: 'User Identification', description: 'Assign unique ID to each person with computer access', severity: 'high' },
    { id: 'PCI-10.2', framework: 'PCI_DSS', control: 'Audit Trail', description: 'Implement automated audit trails for system components', severity: 'critical' },
    { id: 'PCI-10.5', framework: 'PCI_DSS', control: 'Audit Log Security', description: 'Secure audit trails so they cannot be altered', severity: 'high' },
  ],
  ISO27001: [
    { id: 'ISO-A.9.1.1', framework: 'ISO27001', control: 'Access Control Policy', description: 'Establish and implement access control policy', severity: 'high' },
    { id: 'ISO-A.9.2.1', framework: 'ISO27001', control: 'User Registration', description: 'Implement formal user registration and de-registration process', severity: 'high' },
    { id: 'ISO-A.9.2.3', framework: 'ISO27001', control: 'Privileged Access', description: 'Restrict and control allocation of privileged access rights', severity: 'critical' },
    { id: 'ISO-A.9.4.1', framework: 'ISO27001', control: 'Information Access Restriction', description: 'Restrict access to information based on access control policy', severity: 'high' },
    { id: 'ISO-A.12.4.1', framework: 'ISO27001', control: 'Event Logging', description: 'Produce, protect, and regularly review event logs', severity: 'high' },
  ],
};

// Sensitive actions that require special scrutiny
const SENSITIVE_ACTIONS = ['delete', 'admin', 'export', 'bulk-delete', 'bulk-export', 'modify-permissions', 'grant', 'revoke'];
const SENSITIVE_RESOURCES = ['admin-settings', 'payout', 'user-credentials', 'api-keys', 'audit-logs', 'pii', 'phi', 'financial-data'];

export class AdvisorAgent extends BaseAgent {
  private readonly store: DecisionStore;
  private readonly eventBus: EventBus;
  private advisorConfig: AdvisorConfig;
  private explanationCache: Map<string, DecisionExplanation> = new Map();

  /** Get store for testing */
  getStore(): DecisionStore { return this.store; }
  /** Get event bus for testing */
  getEventBus(): EventBus { return this.eventBus; }

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('advisor', 'ADVISOR - LLM Explanations', config);
    this.store = store;
    this.eventBus = eventBus;
    this.advisorConfig = {
      llmProvider: config.advisor?.llmProvider ?? 'openai',
      llmModel: config.advisor?.llmModel ?? 'gpt-4-turbo-preview',
      apiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
      enableNaturalLanguage: config.advisor?.enableNaturalLanguage ?? true,
      maxExplanationLength: config.advisor?.maxExplanationLength ?? 500,
      cacheExplanations: true,
    };
  }

  async initialize(): Promise<void> {
    this.state = 'initializing';
    this.log('info', 'Initializing ADVISOR agent');

    // Verify LLM connection if enabled
    if (this.advisorConfig.enableNaturalLanguage && this.advisorConfig.apiKey) {
      await this.verifyLLMConnection();
    }

    this.state = 'ready';
    this.log('info', 'ADVISOR agent ready');
  }

  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    this.log('info', 'ADVISOR agent shutting down');
  }

  /**
   * Generate explanation for an authorization decision
   */
  async explainDecision(
    request: CheckRequest,
    response: CheckResponse,
    policyContext?: { matchedRules: string[]; derivedRoles: string[] },
  ): Promise<DecisionExplanation> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      // Check cache
      const cacheKey = this.getCacheKey(request, response);
      if (this.advisorConfig.cacheExplanations && this.explanationCache.has(cacheKey)) {
        return this.explanationCache.get(cacheKey)!;
      }

      // Build structured explanation
      const factors = this.analyzeDecisionFactors(request, response, policyContext);
      const firstResult = response.results[Object.keys(response.results)[0]];
      const pathToAllow = isAllowed(firstResult)
        ? undefined
        : this.computePathToAllow(request, response, policyContext);

      let naturalLanguage: string | undefined;
      if (this.advisorConfig.enableNaturalLanguage && this.advisorConfig.apiKey) {
        naturalLanguage = await this.generateNaturalLanguageExplanation(
          request,
          response,
          factors,
          pathToAllow,
        );
      }

      const explanation: DecisionExplanation = {
        requestId: request.requestId || `req-${Date.now()}`,
        generatedAt: new Date(),
        summary: this.generateSummary(request, response, factors),
        factors,
        naturalLanguage,
        recommendations: this.generateRecommendations(request, response, factors),
        pathToAllow,
      };

      // Cache
      if (this.advisorConfig.cacheExplanations) {
        this.explanationCache.set(cacheKey, explanation);
        // Limit cache size
        if (this.explanationCache.size > 1000) {
          const firstKey = this.explanationCache.keys().next().value;
          if (firstKey) this.explanationCache.delete(firstKey);
        }
      }

      this.emitAgentEvent('explanation_generated', {
        requestId: explanation.requestId,
        hasNaturalLanguage: !!naturalLanguage,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return explanation;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  /**
   * Answer a natural language question about policies
   */
  async answerPolicyQuestion(question: string): Promise<string> {
    if (!this.advisorConfig.apiKey) {
      return 'LLM not configured. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY.';
    }

    const startTime = Date.now();

    try {
      const systemPrompt = `You are an authorization policy expert assistant. You help users understand:
- How authorization policies work
- Why decisions are made
- How to write effective policies
- Best practices for access control

Be concise but thorough. Use examples when helpful.`;

      const response = await this.callLLM([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ]);

      this.recordProcessing(Date.now() - startTime, true);
      return response;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      return `Error answering question: ${(error as Error).message}`;
    }
  }

  /**
   * Generate documentation for a policy
   */
  async generatePolicyDocumentation(policyYaml: string): Promise<string> {
    if (!this.advisorConfig.apiKey) {
      return 'LLM not configured.';
    }

    const systemPrompt = `You are a technical writer specializing in authorization policies.
Generate clear, comprehensive documentation for the provided policy.

Include:
1. Summary of what the policy does
2. Who it affects (roles)
3. What resources it controls
4. Key conditions and their meaning
5. Examples of allowed/denied scenarios`;

    return this.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Document this policy:\n\n${policyYaml}` },
    ]);
  }

  /**
   * Debug a policy issue
   */
  async debugPolicy(
    issue: string,
    policyYaml: string,
    testCases?: { request: CheckRequest; expectedResult: boolean; actualResult: boolean }[],
  ): Promise<string> {
    if (!this.advisorConfig.apiKey) {
      return 'LLM not configured.';
    }

    const systemPrompt = `You are an authorization policy debugging expert.
Analyze the policy and issue, then provide:
1. Root cause analysis
2. Step-by-step explanation of policy evaluation
3. Specific fix recommendations
4. Prevention tips`;

    let userContent = `Issue: ${issue}\n\nPolicy:\n${policyYaml}`;

    if (testCases && testCases.length > 0) {
      userContent += '\n\nFailing test cases:';
      for (const tc of testCases) {
        userContent += `\n- Request: ${JSON.stringify(tc.request, null, 2)}`;
        userContent += `\n  Expected: ${tc.expectedResult}, Actual: ${tc.actualResult}`;
      }
    }

    return this.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);
  }

  // ===========================================================================
  // Policy Optimization Recommendations
  // ===========================================================================

  /**
   * Analyze policies and provide optimization recommendations
   */
  async analyzePolicyOptimizations(
    policies: string[],
    decisionHistory?: DecisionRecord[],
  ): Promise<PolicyRecommendation[]> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const recommendations: PolicyRecommendation[] = [];
      const history = decisionHistory || [];

      // Analyze for overly permissive rules
      const overlyPermissive = this.detectOverlyPermissiveRules(policies, history);
      recommendations.push(...overlyPermissive);

      // Analyze for redundant rules
      const redundant = this.detectRedundantRules(policies);
      recommendations.push(...redundant);

      // Analyze for missing conditions
      const missingConditions = this.detectMissingConditions(policies, history);
      recommendations.push(...missingConditions);

      // Analyze for privilege escalation risks
      const escalationRisks = this.detectPrivilegeEscalationRisks(policies);
      recommendations.push(...escalationRisks);

      // Sort by priority
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      this.emitAgentEvent('recommendation_created', {
        type: 'policy_optimization',
        count: recommendations.length,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return recommendations;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  private detectOverlyPermissiveRules(policies: string[], history: DecisionRecord[]): PolicyRecommendation[] {
    const recommendations: PolicyRecommendation[] = [];

    for (const policy of policies) {
      // Detect wildcard permissions
      if (policy.includes('actions: [*]') || policy.includes('actions: ["*"]')) {
        recommendations.push({
          id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'overly_permissive',
          priority: 'critical',
          title: 'Wildcard Action Permission Detected',
          description: 'Policy grants all actions (*) which violates least privilege principle',
          impact: 'Users may have access to sensitive operations they should not perform',
          effort: 'medium',
          suggestedChange: 'Replace wildcard with specific actions: [view, list, create]',
          affectedPolicies: [policy.split('\n')[0]],
          compliance: ['SOC2', 'HIPAA', 'PCI_DSS'],
        });
      }

      // Detect missing conditions on sensitive resources
      if (SENSITIVE_RESOURCES.some(r => policy.includes(r)) && !policy.includes('condition:')) {
        recommendations.push({
          id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'missing_condition',
          priority: 'high',
          title: 'Sensitive Resource Without Conditions',
          description: 'Access to sensitive resource is granted without conditions',
          impact: 'Insufficient access control for sensitive data',
          effort: 'low',
          suggestedChange: 'Add conditions such as ownership check or role requirement',
          affectedPolicies: [policy.split('\n')[0]],
          compliance: ['GDPR', 'HIPAA'],
        });
      }
    }

    // Analyze history for unused broad permissions
    if (history.length > 0) {
      const actionCounts = new Map<string, number>();
      for (const record of history) {
        for (const action of record.actions) {
          actionCounts.set(action, (actionCounts.get(action) || 0) + 1);
        }
      }

      // Find actions that are rarely used
      const totalRequests = history.length;
      for (const [action, count] of actionCounts) {
        if (count / totalRequests < 0.01 && SENSITIVE_ACTIONS.includes(action)) {
          recommendations.push({
            id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            type: 'unused_permission',
            priority: 'medium',
            title: `Rarely Used Sensitive Permission: ${action}`,
            description: `The "${action}" permission is used in less than 1% of requests`,
            impact: 'Unnecessary permissions increase attack surface',
            effort: 'low',
            suggestedChange: `Consider removing or restricting "${action}" permission`,
            affectedPolicies: [],
          });
        }
      }
    }

    return recommendations;
  }

  private detectRedundantRules(policies: string[]): PolicyRecommendation[] {
    const recommendations: PolicyRecommendation[] = [];
    const rulePatterns = new Map<string, string[]>();

    for (const policy of policies) {
      // Extract rule patterns (simplified)
      const pattern = policy.replace(/\s+/g, ' ').trim();
      const existing = rulePatterns.get(pattern);
      if (existing) {
        existing.push(policy);
      } else {
        rulePatterns.set(pattern, [policy]);
      }
    }

    for (const [, matchingPolicies] of rulePatterns) {
      if (matchingPolicies.length > 1) {
        recommendations.push({
          id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          type: 'redundant_rule',
          priority: 'low',
          title: 'Duplicate Policy Rules Detected',
          description: `${matchingPolicies.length} policies have similar rule patterns`,
          impact: 'Maintenance overhead and potential inconsistency',
          effort: 'medium',
          suggestedChange: 'Consolidate duplicate rules into a single policy',
          affectedPolicies: matchingPolicies.map(p => p.split('\n')[0]),
        });
      }
    }

    return recommendations;
  }

  private detectMissingConditions(policies: string[], _history: DecisionRecord[]): PolicyRecommendation[] {
    const recommendations: PolicyRecommendation[] = [];

    for (const policy of policies) {
      // Check for sensitive actions without conditions
      for (const action of SENSITIVE_ACTIONS) {
        if (policy.includes(action) && !policy.includes('condition:')) {
          recommendations.push({
            id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            type: 'missing_condition',
            priority: 'high',
            title: `Sensitive Action "${action}" Without Conditions`,
            description: `The "${action}" action is allowed without additional conditions`,
            impact: 'Risk of unauthorized access to sensitive operations',
            effort: 'low',
            suggestedChange: `Add condition like: condition: principal.attributes.mfa == true`,
            affectedPolicies: [policy.split('\n')[0]],
            compliance: ['SOC2', 'HIPAA', 'PCI_DSS'],
          });
          break; // Only one recommendation per policy
        }
      }
    }

    return recommendations;
  }

  private detectPrivilegeEscalationRisks(policies: string[]): PolicyRecommendation[] {
    const recommendations: PolicyRecommendation[] = [];

    for (const policy of policies) {
      // Detect permission to modify permissions
      if (policy.includes('modify-permissions') || policy.includes('grant') || policy.includes('assign-role')) {
        if (!policy.includes('super-admin') && !policy.includes('security-admin')) {
          recommendations.push({
            id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            type: 'privilege_escalation_risk',
            priority: 'critical',
            title: 'Potential Privilege Escalation Risk',
            description: 'Policy allows permission modification without restricting to security roles',
            impact: 'Users could potentially grant themselves additional permissions',
            effort: 'medium',
            suggestedChange: 'Restrict permission modification to super-admin or security-admin roles only',
            affectedPolicies: [policy.split('\n')[0]],
            compliance: ['SOC2', 'ISO27001'],
          });
        }
      }
    }

    return recommendations;
  }

  // ===========================================================================
  // Least Privilege Analysis
  // ===========================================================================

  /**
   * Analyze a principal's permissions against their actual usage
   */
  async analyzeLeastPrivilege(
    principalId: string,
    grantedPermissions: string[],
    usageHistory: DecisionRecord[],
    lookbackDays = 30,
  ): Promise<LeastPrivilegeAnalysis> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      const relevantHistory = usageHistory.filter(
        r => r.principal.id === principalId && r.timestamp > cutoffDate
      );

      // Collect actually used permissions
      const usedPermissions = new Set<string>();
      const permissionLastUsed = new Map<string, Date>();

      for (const record of relevantHistory) {
        for (const action of record.actions) {
          const result = record.results[action];
          if (result && isAllowed(result)) {
            usedPermissions.add(action);
            const existing = permissionLastUsed.get(action);
            if (!existing || record.timestamp > existing) {
              permissionLastUsed.set(action, record.timestamp);
            }
          }
        }
      }

      const usedArray = Array.from(usedPermissions);
      const unusedPermissions = grantedPermissions.filter(p => !usedPermissions.has(p));

      // Calculate over-privileged score
      const overPrivilegedScore = grantedPermissions.length > 0
        ? unusedPermissions.length / grantedPermissions.length
        : 0;

      // Generate recommendations
      const recommendations: LeastPrivilegeRecommendation[] = [];

      for (const permission of unusedPermissions) {
        const lastUsed = permissionLastUsed.get(permission);
        const isSensitive = SENSITIVE_ACTIONS.includes(permission);

        let suggestedAction: 'remove' | 'review' | 'time_bound' | 'conditional' = 'review';
        let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';

        if (isSensitive && !lastUsed) {
          suggestedAction = 'remove';
          riskLevel = 'high';
        } else if (isSensitive) {
          suggestedAction = 'conditional';
          riskLevel = 'medium';
        } else if (!lastUsed) {
          suggestedAction = 'remove';
          riskLevel = 'low';
        }

        recommendations.push({
          permission,
          reason: lastUsed
            ? `Permission not used since ${lastUsed.toISOString().split('T')[0]}`
            : `Permission never used in the last ${lookbackDays} days`,
          suggestedAction,
          riskLevel,
          lastUsed,
        });
      }

      // Sort recommendations by risk level
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      recommendations.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

      const analysis: LeastPrivilegeAnalysis = {
        principalId,
        grantedPermissions,
        usedPermissions: usedArray,
        unusedPermissions,
        overPrivilegedScore,
        recommendations,
        analysisDate: new Date(),
      };

      this.emitAgentEvent('recommendation_created', {
        type: 'least_privilege',
        principalId,
        unusedCount: unusedPermissions.length,
        overPrivilegedScore,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return analysis;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  // ===========================================================================
  // Role Consolidation Analysis
  // ===========================================================================

  /**
   * Analyze roles for consolidation opportunities
   */
  async analyzeRoleConsolidation(
    roles: Map<string, string[]>, // roleName -> permissions
    usageData?: Map<string, string[]>, // principalId -> roles
  ): Promise<RoleConsolidationAnalysis> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const analyzedRoles = Array.from(roles.keys());
      const consolidationOpportunities: RoleConsolidationOpportunity[] = [];
      const redundantRoles: RedundantRole[] = [];
      const suggestedHierarchy: RoleHierarchyNode[] = [];

      // Find roles with overlapping permissions
      const roleArray = Array.from(roles.entries());
      for (let i = 0; i < roleArray.length; i++) {
        const [roleName1, perms1] = roleArray[i];
        const perms1Set = new Set(perms1);

        for (let j = i + 1; j < roleArray.length; j++) {
          const [roleName2, perms2] = roleArray[j];
          const perms2Set = new Set(perms2);

          // Calculate overlap
          const intersection = perms1.filter(p => perms2Set.has(p));
          const union = new Set([...perms1, ...perms2]);
          const overlap = intersection.length / union.size;

          if (overlap > 0.8) {
            // Roles are nearly identical
            redundantRoles.push({
              roleName: perms1.length < perms2.length ? roleName1 : roleName2,
              duplicateOf: perms1.length < perms2.length ? roleName2 : roleName1,
              permissionSimilarity: overlap,
              recommendation: `Consider merging "${roleName1}" and "${roleName2}" into a single role`,
            });
          } else if (overlap > 0.5) {
            // Significant overlap - consolidation opportunity
            const affectedPrincipals = usageData
              ? Array.from(usageData.entries())
                  .filter(([, principalRoles]) =>
                    principalRoles.includes(roleName1) || principalRoles.includes(roleName2)
                  ).length
              : 0;

            consolidationOpportunities.push({
              sourceRoles: [roleName1, roleName2],
              targetRole: `${roleName1}_${roleName2}_combined`,
              permissionOverlap: overlap,
              affectedPrincipals,
              rationale: `${Math.round(overlap * 100)}% permission overlap suggests consolidation`,
              effort: affectedPrincipals > 100 ? 'high' : affectedPrincipals > 20 ? 'medium' : 'low',
            });
          }
        }

        // Build hierarchy suggestion
        suggestedHierarchy.push({
          roleName: roleName1,
          inheritsFrom: roleArray
            .filter(([name, perms]) =>
              name !== roleName1 &&
              perms.every(p => perms1Set.has(p)) &&
              perms.length < perms1.length
            )
            .map(([name]) => name),
          permissions: perms1.filter(p =>
            !roleArray.some(([name, perms]) =>
              name !== roleName1 &&
              perms.every(pp => perms1Set.has(pp)) &&
              perms.includes(p)
            )
          ),
          children: roleArray
            .filter(([name, perms]) =>
              name !== roleName1 &&
              perms1.every(p => new Set(perms).has(p)) &&
              perms.length > perms1.length
            )
            .map(([name]) => name),
        });
      }

      // Calculate estimated reduction
      const estimatedReduction = analyzedRoles.length > 0
        ? redundantRoles.length / analyzedRoles.length
        : 0;

      const analysis: RoleConsolidationAnalysis = {
        analyzedRoles,
        consolidationOpportunities,
        redundantRoles,
        suggestedRoleHierarchy: suggestedHierarchy,
        estimatedReduction,
        analysisDate: new Date(),
      };

      this.emitAgentEvent('recommendation_created', {
        type: 'role_consolidation',
        rolesAnalyzed: analyzedRoles.length,
        redundantFound: redundantRoles.length,
        consolidationOpportunities: consolidationOpportunities.length,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return analysis;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  // ===========================================================================
  // Compliance Mapping
  // ===========================================================================

  /**
   * Map policies to compliance frameworks and identify gaps
   */
  async mapCompliance(
    framework: ComplianceFramework,
    policies: string[],
    currentControls?: Map<string, boolean>,
  ): Promise<ComplianceMapping> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const requirements = COMPLIANCE_REQUIREMENTS[framework] || [];
      const gaps: ComplianceGap[] = [];
      const recommendations: string[] = [];
      let coveredControls = 0;

      // Analyze each requirement
      for (const req of requirements) {
        const isControlImplemented = currentControls?.get(req.id) ?? false;
        const isPolicyPresent = this.checkPolicyCoversRequirement(policies, req);

        if (!isControlImplemented && !isPolicyPresent) {
          gaps.push({
            requirementId: req.id,
            control: req.control,
            description: req.description,
            remediation: this.getRemediationGuidance(req),
            priority: req.severity,
          });
        } else {
          coveredControls++;
        }
      }

      const coverage = requirements.length > 0 ? coveredControls / requirements.length : 0;

      // Generate framework-specific recommendations
      if (gaps.length > 0) {
        const criticalGaps = gaps.filter(g => g.priority === 'critical');
        if (criticalGaps.length > 0) {
          recommendations.push(
            `URGENT: ${criticalGaps.length} critical ${framework} controls are missing`
          );
        }

        recommendations.push(
          `Implement ${gaps.length} missing controls to achieve ${framework} compliance`,
          `Current coverage: ${Math.round(coverage * 100)}%`,
          ...this.getFrameworkSpecificRecommendations(framework, gaps),
        );
      }

      const mapping: ComplianceMapping = {
        framework,
        requirements,
        coverage,
        gaps,
        recommendations,
      };

      this.emitAgentEvent('recommendation_created', {
        type: 'compliance_mapping',
        framework,
        coverage,
        gapsCount: gaps.length,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return mapping;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  private checkPolicyCoversRequirement(policies: string[], req: ComplianceRequirement): boolean {
    // Simplified check - in production, use more sophisticated analysis
    const controlKeywords = req.control.toLowerCase().split(' ');
    return policies.some(policy => {
      const policyLower = policy.toLowerCase();
      return controlKeywords.some(kw => policyLower.includes(kw));
    });
  }

  private getRemediationGuidance(req: ComplianceRequirement): string {
    const guidanceMap: Record<string, string> = {
      'Access Control': 'Implement role-based access control with explicit deny by default',
      'Audit Controls': 'Enable comprehensive audit logging for all authorization decisions',
      'Integrity': 'Implement data integrity checks and tamper-evident logging',
      'Person Authentication': 'Require multi-factor authentication for sensitive operations',
      'Access Management': 'Establish formal access request and approval workflows',
      'Logical Access Security': 'Implement network segmentation and access restrictions',
      'Segregation of Duties': 'Define mutually exclusive roles for sensitive operations',
      'Security Monitoring': 'Deploy real-time anomaly detection and alerting',
    };

    return guidanceMap[req.control] || `Implement controls for: ${req.description}`;
  }

  private getFrameworkSpecificRecommendations(framework: ComplianceFramework, gaps: ComplianceGap[]): string[] {
    const recommendations: string[] = [];

    switch (framework) {
      case 'GDPR':
        if (gaps.some(g => g.control.includes('Data Protection'))) {
          recommendations.push('Implement data classification and protection policies');
        }
        recommendations.push('Document all data processing activities');
        break;
      case 'SOC2':
        recommendations.push('Establish formal change management procedures');
        recommendations.push('Implement continuous monitoring and alerting');
        break;
      case 'HIPAA':
        recommendations.push('Ensure all ePHI access is logged and auditable');
        recommendations.push('Implement minimum necessary access principle');
        break;
      case 'PCI_DSS':
        recommendations.push('Restrict access to cardholder data on a need-to-know basis');
        recommendations.push('Implement strong cryptographic controls');
        break;
      case 'ISO27001':
        recommendations.push('Establish information security management system (ISMS)');
        recommendations.push('Conduct regular security risk assessments');
        break;
    }

    return recommendations;
  }

  // ===========================================================================
  // Security Posture Assessment
  // ===========================================================================

  /**
   * Perform comprehensive security posture assessment
   */
  async assessSecurityPosture(
    policies: string[],
    decisionHistory: DecisionRecord[],
    roleDefinitions?: Map<string, string[]>,
  ): Promise<SecurityPostureAssessment> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const findings: SecurityFinding[] = [];
      const categories: SecurityCategory[] = [];
      const hardeningRecommendations: HardeningRecommendation[] = [];

      // Access Control Category
      const accessControlFindings = this.assessAccessControl(policies, decisionHistory);
      findings.push(...accessControlFindings);
      categories.push(this.createSecurityCategory('Access Control', accessControlFindings, 0.3));

      // Least Privilege Category
      const leastPrivilegeFindings = this.assessLeastPrivilegePosture(policies, roleDefinitions);
      findings.push(...leastPrivilegeFindings);
      categories.push(this.createSecurityCategory('Least Privilege', leastPrivilegeFindings, 0.25));

      // Audit & Monitoring Category
      const auditFindings = this.assessAuditPosture(policies);
      findings.push(...auditFindings);
      categories.push(this.createSecurityCategory('Audit & Monitoring', auditFindings, 0.2));

      // Data Protection Category
      const dataProtectionFindings = this.assessDataProtection(policies);
      findings.push(...dataProtectionFindings);
      categories.push(this.createSecurityCategory('Data Protection', dataProtectionFindings, 0.25));

      // Calculate overall score
      const overallScore = categories.reduce(
        (sum, cat) => sum + cat.score * cat.weight,
        0
      );

      // Determine risk level
      let riskLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
      if (overallScore < 40) riskLevel = 'critical';
      else if (overallScore < 60) riskLevel = 'high';
      else if (overallScore < 80) riskLevel = 'medium';

      // Generate hardening recommendations
      hardeningRecommendations.push(...this.generateHardeningRecommendations(findings, categories));

      const assessment: SecurityPostureAssessment = {
        overallScore: Math.round(overallScore),
        riskLevel,
        categories,
        findings,
        hardeningRecommendations,
        assessmentDate: new Date(),
      };

      this.emitAgentEvent('recommendation_created', {
        type: 'security_posture',
        overallScore: assessment.overallScore,
        riskLevel,
        findingsCount: findings.length,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return assessment;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  private assessAccessControl(policies: string[], history: DecisionRecord[]): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Check for wildcard permissions
    for (const policy of policies) {
      if (policy.includes('*') && !policy.includes('condition:')) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          category: 'Access Control',
          severity: 'critical',
          title: 'Unrestricted Wildcard Permission',
          description: 'Policy contains wildcard (*) permission without conditions',
          evidence: policy.substring(0, 100),
          remediation: 'Replace wildcards with specific permissions and add conditions',
          compliance: ['SOC2', 'HIPAA', 'PCI_DSS'],
        });
      }
    }

    // Check denial rate
    if (history.length > 100) {
      const denials = history.filter(h =>
        Object.values(h.results).some(r => !isAllowed(r))
      ).length;
      const denialRate = denials / history.length;

      if (denialRate > 0.3) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          category: 'Access Control',
          severity: 'medium',
          title: 'High Denial Rate Detected',
          description: `${Math.round(denialRate * 100)}% of requests are denied`,
          evidence: `${denials} denials out of ${history.length} requests`,
          remediation: 'Review policies to ensure legitimate access is not being blocked',
        });
      }
    }

    return findings;
  }

  private assessLeastPrivilegePosture(policies: string[], roleDefinitions?: Map<string, string[]>): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Check for overly broad roles
    if (roleDefinitions) {
      for (const [roleName, permissions] of roleDefinitions) {
        const sensitivePerms = permissions.filter(p => SENSITIVE_ACTIONS.includes(p));
        if (sensitivePerms.length > 3) {
          findings.push({
            id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            category: 'Least Privilege',
            severity: 'high',
            title: `Role "${roleName}" Has Too Many Sensitive Permissions`,
            description: `Role has ${sensitivePerms.length} sensitive permissions`,
            evidence: sensitivePerms.join(', '),
            remediation: 'Split role into more granular roles based on function',
            compliance: ['SOC2', 'ISO27001'],
          });
        }
      }
    }

    // Check for missing ownership conditions
    for (const policy of policies) {
      if (policy.includes('delete') && !policy.includes('ownerId') && !policy.includes('admin')) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          category: 'Least Privilege',
          severity: 'high',
          title: 'Delete Permission Without Ownership Check',
          description: 'Delete action allowed without verifying resource ownership',
          evidence: policy.substring(0, 100),
          remediation: 'Add condition: resource.ownerId == principal.id',
        });
      }
    }

    return findings;
  }

  private assessAuditPosture(policies: string[]): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Check if audit logging mentions are present
    const hasAuditConfig = policies.some(p =>
      p.includes('audit') || p.includes('log') || p.includes('trace')
    );

    if (!hasAuditConfig) {
      findings.push({
        id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        category: 'Audit & Monitoring',
        severity: 'high',
        title: 'No Audit Configuration Detected',
        description: 'Policies do not appear to include audit logging configuration',
        evidence: 'No audit, log, or trace keywords found in policies',
        remediation: 'Implement comprehensive audit logging for all authorization decisions',
        compliance: ['SOC2', 'HIPAA', 'PCI_DSS'],
      });
    }

    return findings;
  }

  private assessDataProtection(policies: string[]): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    // Check for sensitive data handling
    const hasSensitiveResources = policies.some(p =>
      SENSITIVE_RESOURCES.some(r => p.includes(r))
    );

    if (hasSensitiveResources) {
      const hasEncryptionMention = policies.some(p =>
        p.includes('encrypt') || p.includes('secure') || p.includes('confidential')
      );

      if (!hasEncryptionMention) {
        findings.push({
          id: `finding-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          category: 'Data Protection',
          severity: 'medium',
          title: 'Sensitive Resources Without Explicit Protection',
          description: 'Policies reference sensitive resources without encryption/security markers',
          evidence: 'Sensitive resources detected without explicit protection controls',
          remediation: 'Add data classification and protection requirements for sensitive resources',
          compliance: ['GDPR', 'HIPAA'],
        });
      }
    }

    return findings;
  }

  private createSecurityCategory(name: string, findings: SecurityFinding[], weight: number): SecurityCategory {
    const critical = findings.filter(f => f.severity === 'critical').length;
    const high = findings.filter(f => f.severity === 'high').length;
    const medium = findings.filter(f => f.severity === 'medium').length;
    const low = findings.filter(f => f.severity === 'low').length;

    // Calculate score (100 - weighted penalty for findings)
    const penalty = critical * 25 + high * 15 + medium * 8 + low * 3;
    const score = Math.max(0, 100 - penalty);

    return {
      name,
      score,
      weight,
      findings: findings.length,
      critical,
      high,
      medium,
      low,
    };
  }

  private generateHardeningRecommendations(
    findings: SecurityFinding[],
    categories: SecurityCategory[],
  ): HardeningRecommendation[] {
    const recommendations: HardeningRecommendation[] = [];

    // Add recommendations based on lowest scoring categories
    const sortedCategories = [...categories].sort((a, b) => a.score - b.score);

    for (const category of sortedCategories.slice(0, 2)) {
      if (category.score < 80) {
        recommendations.push({
          id: `hardening-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          category: category.name,
          title: `Improve ${category.name} Controls`,
          description: `Category score is ${category.score}/100 with ${category.findings} findings`,
          implementation: this.getImplementationGuidance(category.name),
          priority: category.score < 50 ? 'critical' : category.score < 70 ? 'high' : 'medium',
          effort: category.critical > 0 ? 'high' : 'medium',
          securityImpact: Math.round((100 - category.score) / 10),
        });
      }
    }

    // Add specific recommendations based on critical findings
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    for (const finding of criticalFindings) {
      recommendations.push({
        id: `hardening-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        category: finding.category,
        title: `Address: ${finding.title}`,
        description: finding.description,
        implementation: finding.remediation,
        priority: 'critical',
        effort: 'medium',
        securityImpact: 9,
      });
    }

    return recommendations;
  }

  private getImplementationGuidance(category: string): string {
    const guidance: Record<string, string> = {
      'Access Control': 'Review and tighten access policies, implement deny-by-default, add specific conditions',
      'Least Privilege': 'Audit role assignments, remove unused permissions, implement just-in-time access',
      'Audit & Monitoring': 'Enable comprehensive logging, implement real-time alerting, establish log retention policies',
      'Data Protection': 'Classify sensitive data, implement encryption, establish data handling procedures',
    };

    return guidance[category] || 'Review and improve security controls in this category';
  }

  // ===========================================================================
  // Security Hardening Recommendations
  // ===========================================================================

  /**
   * Generate specific security hardening recommendations
   */
  async getSecurityHardeningRecommendations(
    policies: string[],
    options?: { includeCompliance?: boolean; targetFrameworks?: ComplianceFramework[] },
  ): Promise<HardeningRecommendation[]> {
    const startTime = Date.now();
    this.state = 'processing';

    try {
      const recommendations: HardeningRecommendation[] = [];

      // 1. Default deny recommendation
      const hasDefaultDeny = policies.some(p => p.includes('defaultEffect: deny'));
      if (!hasDefaultDeny) {
        recommendations.push({
          id: `hardening-${Date.now()}-1`,
          category: 'Access Control',
          title: 'Implement Default Deny Policy',
          description: 'No explicit default deny policy detected',
          implementation: 'Add a catch-all policy with effect: deny for unmatched requests',
          priority: 'critical',
          effort: 'low',
          securityImpact: 10,
        });
      }

      // 2. MFA for sensitive operations
      const hasMfaRequirement = policies.some(p =>
        p.includes('mfa') || p.includes('multi-factor')
      );
      if (!hasMfaRequirement) {
        recommendations.push({
          id: `hardening-${Date.now()}-2`,
          category: 'Authentication',
          title: 'Require MFA for Sensitive Operations',
          description: 'No MFA requirement detected for sensitive actions',
          implementation: 'Add condition: principal.attributes.mfaVerified == true for sensitive actions',
          priority: 'high',
          effort: 'medium',
          securityImpact: 8,
        });
      }

      // 3. Time-based access restrictions
      const hasTimeRestrictions = policies.some(p =>
        p.includes('time') || p.includes('hour') || p.includes('schedule')
      );
      if (!hasTimeRestrictions) {
        recommendations.push({
          id: `hardening-${Date.now()}-3`,
          category: 'Access Control',
          title: 'Implement Time-Based Access Controls',
          description: 'Consider restricting sensitive operations to business hours',
          implementation: 'Add conditions like: context.time.hour >= 9 && context.time.hour <= 17',
          priority: 'medium',
          effort: 'low',
          securityImpact: 5,
        });
      }

      // 4. IP-based restrictions
      const hasIpRestrictions = policies.some(p =>
        p.includes('ip') || p.includes('network') || p.includes('cidr')
      );
      if (!hasIpRestrictions) {
        recommendations.push({
          id: `hardening-${Date.now()}-4`,
          category: 'Network Security',
          title: 'Implement IP-Based Access Restrictions',
          description: 'No IP/network-based access controls detected',
          implementation: 'Add conditions to restrict admin access to trusted networks',
          priority: 'medium',
          effort: 'medium',
          securityImpact: 6,
        });
      }

      // 5. Rate limiting
      const hasRateLimiting = policies.some(p =>
        p.includes('rate') || p.includes('limit') || p.includes('throttle')
      );
      if (!hasRateLimiting) {
        recommendations.push({
          id: `hardening-${Date.now()}-5`,
          category: 'Abuse Prevention',
          title: 'Implement Rate Limiting',
          description: 'No rate limiting controls detected in policies',
          implementation: 'Add rate limiting rules to prevent bulk operations abuse',
          priority: 'high',
          effort: 'medium',
          securityImpact: 7,
        });
      }

      // 6. Session management
      const hasSessionControls = policies.some(p =>
        p.includes('session') || p.includes('token') || p.includes('expir')
      );
      if (!hasSessionControls) {
        recommendations.push({
          id: `hardening-${Date.now()}-6`,
          category: 'Session Management',
          title: 'Implement Session Controls',
          description: 'No session-based access controls detected',
          implementation: 'Add session timeout and re-authentication requirements',
          priority: 'medium',
          effort: 'medium',
          securityImpact: 6,
        });
      }

      // Sort by priority and impact
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      recommendations.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        return priorityDiff !== 0 ? priorityDiff : b.securityImpact - a.securityImpact;
      });

      this.emitAgentEvent('recommendation_created', {
        type: 'security_hardening',
        count: recommendations.length,
      });

      this.recordProcessing(Date.now() - startTime, true);
      this.state = 'ready';

      return recommendations;

    } catch (error) {
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
      this.state = 'error';
      throw error;
    }
  }

  // ===========================================================================
  // Private Helper Methods (existing)
  // ===========================================================================

  private analyzeDecisionFactors(
    request: CheckRequest,
    response: CheckResponse,
    policyContext?: { matchedRules: string[]; derivedRoles: string[] },
  ): ExplanationFactor[] {
    const factors: ExplanationFactor[] = [];
    const action = request.actions[0];
    const result = response.results[action];

    if (!result) {
      factors.push({
        type: 'no_match',
        description: 'No matching policy found for this request',
        impact: 'denied',
        details: { action, resource: request.resource.kind },
      });
      return factors;
    }

    // Role factor
    if (request.principal.roles.length > 0) {
      factors.push({
        type: 'role',
        description: `Principal has roles: ${request.principal.roles.join(', ')}`,
        impact: 'neutral',
        details: { roles: request.principal.roles },
      });
    }

    // Derived roles factor
    if (policyContext?.derivedRoles && policyContext.derivedRoles.length > 0) {
      factors.push({
        type: 'derived_role',
        description: `Derived roles computed: ${policyContext.derivedRoles.join(', ')}`,
        impact: isAllowed(result) ? 'allowed' : 'neutral',
        details: { derivedRoles: policyContext.derivedRoles },
      });
    }

    // Matched rules factor
    if (policyContext?.matchedRules && policyContext.matchedRules.length > 0) {
      factors.push({
        type: 'condition',
        description: `Matched rules: ${policyContext.matchedRules.join(', ')}`,
        impact: isAllowed(result) ? 'allowed' : 'denied',
        details: { matchedRules: policyContext.matchedRules },
      });
    }

    // Explicit deny factor
    const matchedRule = result.meta?.matchedRule;
    if (!isAllowed(result) && matchedRule?.includes('deny')) {
      factors.push({
        type: 'explicit_deny',
        description: 'An explicit deny rule matched this request',
        impact: 'denied',
        details: { rule: matchedRule },
      });
    }

    return factors;
  }

  private computePathToAllow(
    request: CheckRequest,
    _response: CheckResponse,
    _policyContext?: { matchedRules: string[]; derivedRoles: string[] },
  ): PathToAllow {
    const pathToAllow: PathToAllow = {};

    // Suggest roles that might help
    const possibleRoles = ['admin', 'owner', 'manager'];
    const missingRoles = possibleRoles.filter(r => !request.principal.roles.includes(r));
    if (missingRoles.length > 0) {
      pathToAllow.missingRoles = missingRoles.slice(0, 3);
    }

    // Suggest ownership if resource has ownerId
    if (request.resource.attributes && 'ownerId' in request.resource.attributes) {
      if (request.resource.attributes.ownerId !== request.principal.id) {
        pathToAllow.missingAttributes = [{
          key: 'ownerId',
          expectedValue: request.principal.id,
        }];
      }
    }

    // Suggest conditions
    pathToAllow.requiredConditions = [
      'Principal must have appropriate role for this action',
      'Resource ownership or delegation must be established',
    ];

    // Suggest actions
    pathToAllow.suggestedActions = [
      'Request access from resource owner',
      'Contact administrator to grant appropriate role',
    ];

    return pathToAllow;
  }

  private generateSummary(
    request: CheckRequest,
    response: CheckResponse,
    factors: ExplanationFactor[],
  ): string {
    const action = request.actions[0];
    const result = response.results[action];
    const allowed = isAllowed(result);

    const verb = allowed ? 'ALLOWED' : 'DENIED';
    const principalDesc = request.principal.roles.length > 0
      ? `${request.principal.roles[0]}`
      : 'user';

    let summary = `${verb}: ${principalDesc} "${action}" on ${request.resource.kind}`;

    // Add key reason
    const keyFactor = factors.find(f => f.impact === (allowed ? 'allowed' : 'denied'));
    if (keyFactor) {
      summary += ` - ${keyFactor.description}`;
    }

    return summary;
  }

  private generateRecommendations(
    request: CheckRequest,
    response: CheckResponse,
    factors: ExplanationFactor[],
  ): string[] {
    const recommendations: string[] = [];
    const action = request.actions[0];
    const result = response.results[action];

    if (!isAllowed(result)) {
      // Recommendations for denied requests
      if (factors.some(f => f.type === 'no_match')) {
        recommendations.push('Consider adding a policy rule for this resource/action combination');
      }

      if (factors.some(f => f.type === 'explicit_deny')) {
        recommendations.push('Review the deny rule to ensure it is not overly broad');
      }

      recommendations.push(
        'Verify the principal has the correct roles assigned',
        'Check if derived roles are being computed correctly',
      );
    } else {
      // Recommendations for allowed requests
      if (factors.some(f => f.type === 'derived_role')) {
        recommendations.push('Derived role matched - consider if this is the intended behavior');
      }

      recommendations.push(
        'Audit this access pattern periodically',
        'Consider adding more specific conditions if needed',
      );
    }

    return recommendations;
  }

  private async generateNaturalLanguageExplanation(
    request: CheckRequest,
    response: CheckResponse,
    factors: ExplanationFactor[],
    pathToAllow?: PathToAllow,
  ): Promise<string> {
    const action = request.actions[0];
    const result = response.results[action];

    const systemPrompt = `You are an authorization policy explainer.
Generate a clear, concise explanation for end users (not developers).
Keep it under ${this.advisorConfig.maxExplanationLength} characters.
Be helpful and suggest next steps if access was denied.`;

    const context = {
      request: {
        principal: {
          id: request.principal.id,
          roles: request.principal.roles,
        },
        resource: {
          kind: request.resource.kind,
          id: request.resource.id,
        },
        action: action,
      },
      result: isAllowed(result) ? 'allowed' : 'denied',
      factors: factors.map(f => ({ type: f.type, description: f.description })),
      pathToAllow,
    };

    const userContent = `Explain this authorization decision:\n${JSON.stringify(context, null, 2)}`;

    return this.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ]);
  }

  private async callLLM(messages: LLMMessage[]): Promise<string> {
    if (this.advisorConfig.llmProvider === 'openai') {
      return this.callOpenAI(messages);
    } else if (this.advisorConfig.llmProvider === 'anthropic') {
      return this.callAnthropic(messages);
    }

    return 'LLM provider not supported';
  }

  private async callOpenAI(messages: LLMMessage[]): Promise<string> {
    const { default: OpenAI } = await import('openai');

    const openai = new OpenAI({ apiKey: this.advisorConfig.apiKey });

    const completion = await openai.chat.completions.create({
      model: this.advisorConfig.llmModel,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: 1000,
      temperature: 0.3,
    });

    return completion.choices[0]?.message?.content || 'No response generated';
  }

  private async callAnthropic(messages: LLMMessage[]): Promise<string> {
    // Anthropic API implementation
    // Using fetch for simplicity
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.advisorConfig.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.advisorConfig.llmModel || 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        system: messages.find(m => m.role === 'system')?.content,
        messages: messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text || 'No response generated';
  }

  private async verifyLLMConnection(): Promise<void> {
    try {
      await this.callLLM([
        { role: 'user', content: 'Hello, this is a connection test. Reply with "OK".' },
      ]);
      this.log('info', 'LLM connection verified');
    } catch (error) {
      this.log('warn', 'LLM connection failed, natural language explanations disabled', error);
      this.advisorConfig.enableNaturalLanguage = false;
    }
  }

  private getCacheKey(request: CheckRequest, response: CheckResponse): string {
    return `${request.principal.id}:${request.resource.kind}:${request.resource.id}:${request.actions.join(',')}:${Object.values(response.results).map(r => r.effect).join(',')}`;
  }
}
