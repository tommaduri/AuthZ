/**
 * ADVISOR Agent - LLM-Powered Explanations & Recommendations
 *
 * Responsibilities:
 * - Generate natural language explanations for authorization decisions
 * - Provide "path to allow" recommendations
 * - Answer natural language policy questions
 * - Generate policy documentation
 * - Assist with policy debugging
 */

import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  DecisionExplanation,
  ExplanationFactor,
  PathToAllow,
} from '../types/agent.types.js';
import type { CheckRequest, CheckResponse, ActionResult } from '@authz-engine/core';

/**
 * Helper to check if an ActionResult is allowed
 */
function isAllowed(result: ActionResult | undefined): boolean {
  return result?.effect === 'allow';
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
