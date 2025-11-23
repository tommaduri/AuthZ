/**
 * ENFORCER Agent - Autonomous Action Execution
 *
 * Responsibilities:
 * - Execute protective actions based on anomaly detection
 * - Rate limit suspicious principals
 * - Temporarily block high-risk sessions
 * - Escalate to human review
 * - Maintain audit trail of all actions
 * - Support rollback of actions
 */

import { BaseAgent } from '../core/base-agent.js';
import type { DecisionStore } from '../core/decision-store.js';
import type { EventBus } from '../core/event-bus.js';
import type {
  AgentConfig,
  EnforcerAction,
  EnforcerActionType,
  EnforcerActionResult,
  Priority,
  Anomaly,
  AgentEvent,
} from '../types/agent.types.js';

export interface EnforcerConfig {
  autoEnforceEnabled: boolean;
  requireApprovalForSeverity: Priority;
  maxActionsPerHour: number;
  rollbackWindowMinutes: number;
  webhookUrl?: string;
  alertEmail?: string;
}

interface RateLimitEntry {
  principalId: string;
  limitUntil: Date;
  reason: string;
  actionId: string;
}

interface BlockEntry {
  principalId: string;
  blockedUntil: Date;
  reason: string;
  actionId: string;
}

export class EnforcerAgent extends BaseAgent {
  private store: DecisionStore;
  private eventBus: EventBus;
  private enforcerConfig: EnforcerConfig;

  // In-memory enforcement state
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private blocks: Map<string, BlockEntry> = new Map();
  private pendingActions: Map<string, EnforcerAction> = new Map();
  private actionsThisHour: number = 0;
  private lastHourReset: Date = new Date();

  /** Get last hour reset time for testing */
  getLastHourReset(): Date { return this.lastHourReset; }

  constructor(
    config: AgentConfig,
    store: DecisionStore,
    eventBus: EventBus,
  ) {
    super('enforcer', 'ENFORCER - Action Execution', config);
    this.store = store;
    this.eventBus = eventBus;
    this.enforcerConfig = {
      autoEnforceEnabled: config.enforcer?.autoEnforceEnabled ?? false,
      requireApprovalForSeverity: config.enforcer?.requireApprovalForSeverity ?? 'high',
      maxActionsPerHour: config.enforcer?.maxActionsPerHour ?? 100,
      rollbackWindowMinutes: config.enforcer?.rollbackWindowMinutes ?? 60,
    };
  }

  async initialize(): Promise<void> {
    this.state = 'initializing';
    this.log('info', 'Initializing ENFORCER agent');

    // Subscribe to anomaly events from GUARDIAN
    this.eventBus.subscribe('anomaly_detected', async (event) => {
      await this.handleAnomalyDetected(event);
    });

    // Start cleanup job
    this.startCleanupJob();

    // Start hourly rate reset
    this.startHourlyReset();

    this.state = 'ready';
    this.log('info', 'ENFORCER agent ready');
  }

  async shutdown(): Promise<void> {
    this.state = 'shutdown';
    this.log('info', 'ENFORCER agent shutting down');
  }

  /**
   * Check if a principal is allowed to proceed
   * Returns false if rate limited or blocked
   */
  isAllowed(principalId: string): { allowed: boolean; reason?: string } {
    // Check blocks
    const block = this.blocks.get(principalId);
    if (block && block.blockedUntil > new Date()) {
      return { allowed: false, reason: `Blocked: ${block.reason}` };
    }

    // Check rate limits
    const rateLimit = this.rateLimits.get(principalId);
    if (rateLimit && rateLimit.limitUntil > new Date()) {
      return { allowed: false, reason: `Rate limited: ${rateLimit.reason}` };
    }

    return { allowed: true };
  }

  /**
   * Manually trigger an enforcement action
   */
  async triggerAction(
    actionType: EnforcerActionType,
    principalId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<EnforcerAction> {
    const action = this.createAction(actionType, principalId, reason, metadata);
    return this.executeAction(action);
  }

  /**
   * Approve a pending action
   */
  async approveAction(actionId: string, approvedBy: string): Promise<EnforcerAction | null> {
    const action = this.pendingActions.get(actionId);
    if (!action) return null;

    this.log('info', `Action ${actionId} approved by ${approvedBy}`);
    this.pendingActions.delete(actionId);

    return this.executeAction(action);
  }

  /**
   * Reject a pending action
   */
  rejectAction(actionId: string, rejectedBy: string, reason?: string): boolean {
    const action = this.pendingActions.get(actionId);
    if (!action) return false;

    action.status = 'cancelled';
    this.pendingActions.delete(actionId);

    this.log('info', `Action ${actionId} rejected by ${rejectedBy}: ${reason}`);
    return true;
  }

  /**
   * Rollback an action
   */
  async rollbackAction(actionId: string): Promise<boolean> {
    // Find the action in our records
    const action = Array.from(this.pendingActions.values()).find(a => a.id === actionId);

    if (!action || !action.canRollback) {
      return false;
    }

    const principalId = (action.triggeredBy.relatedIds[0] || '').split(':')[1];
    if (!principalId) return false;

    // Remove rate limits and blocks
    this.rateLimits.delete(principalId);
    this.blocks.delete(principalId);

    action.rolledBackAt = new Date();
    this.emitAgentEvent('action_rolled_back', { actionId, principalId });

    this.log('info', `Action ${actionId} rolled back`);
    return true;
  }

  /**
   * Get all pending actions
   */
  getPendingActions(): EnforcerAction[] {
    return Array.from(this.pendingActions.values());
  }

  /**
   * Get current rate limits
   */
  getRateLimits(): RateLimitEntry[] {
    return Array.from(this.rateLimits.values());
  }

  /**
   * Get current blocks
   */
  getBlocks(): BlockEntry[] {
    return Array.from(this.blocks.values());
  }

  private async handleAnomalyDetected(event: AgentEvent): Promise<void> {
    const anomaly = event.payload as Anomaly;

    // Determine appropriate action based on severity
    const actionType = this.determineActionType(anomaly);
    if (!actionType) return;

    const action = this.createAction(
      actionType,
      anomaly.principalId,
      anomaly.description,
      { anomalyId: anomaly.id, anomalyType: anomaly.type },
    );

    // Check if auto-enforce is enabled and severity allows it
    const severityLevels: Priority[] = ['low', 'medium', 'high', 'critical'];
    const anomalySeverityIndex = severityLevels.indexOf(anomaly.severity);
    const requireApprovalIndex = severityLevels.indexOf(this.enforcerConfig.requireApprovalForSeverity);

    if (this.enforcerConfig.autoEnforceEnabled && anomalySeverityIndex < requireApprovalIndex) {
      await this.executeAction(action);
    } else {
      // Queue for approval
      this.pendingActions.set(action.id, action);
      this.log('info', `Action ${action.id} queued for approval: ${actionType}`);

      // Send alert
      await this.sendAlert(action, anomaly);
    }
  }

  private determineActionType(anomaly: Anomaly): EnforcerActionType | null {
    switch (anomaly.severity) {
      case 'critical':
        return 'temporary_block';
      case 'high':
        return anomaly.type === 'permission_escalation' ? 'require_mfa' : 'rate_limit';
      case 'medium':
        return 'rate_limit';
      case 'low':
        return 'alert_admin';
      default:
        return null;
    }
  }

  private createAction(
    type: EnforcerActionType,
    principalId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): EnforcerAction {
    const action: EnforcerAction = {
      id: `action-${Date.now()}-${Math.random().toString(36).substring(2)}`,
      triggeredAt: new Date(),
      type,
      priority: this.getPriorityForActionType(type),
      triggeredBy: {
        agentType: 'enforcer',
        reason,
        relatedIds: [`principal:${principalId}`, ...(metadata?.anomalyId ? [`anomaly:${metadata.anomalyId}`] : [])],
      },
      status: 'pending',
      canRollback: type !== 'alert_admin' && type !== 'escalate_review',
    };

    return action;
  }

  private async executeAction(action: EnforcerAction): Promise<EnforcerAction> {
    const startTime = Date.now();
    this.state = 'processing';

    // Check rate limit for actions
    if (!this.canExecuteAction()) {
      action.status = 'failed';
      action.result = {
        success: false,
        message: 'Hourly action limit exceeded',
        affectedEntities: [],
      };
      return action;
    }

    try {
      const principalId = action.triggeredBy.relatedIds
        .find(id => id.startsWith('principal:'))
        ?.split(':')[1];

      if (!principalId) {
        throw new Error('No principal ID in action');
      }

      let result: EnforcerActionResult;

      switch (action.type) {
        case 'rate_limit':
          result = this.applyRateLimit(principalId, action);
          break;
        case 'temporary_block':
          result = this.applyBlock(principalId, action);
          break;
        case 'require_mfa':
          result = await this.requestMfa(principalId, action);
          break;
        case 'alert_admin':
          result = await this.alertAdmin(principalId, action);
          break;
        case 'revoke_session':
          result = await this.revokeSession(principalId, action);
          break;
        case 'quarantine_resource':
          result = await this.quarantineResource(principalId, action);
          break;
        case 'escalate_review':
          result = await this.escalateReview(principalId, action);
          break;
        default:
          result = { success: false, message: 'Unknown action type', affectedEntities: [] };
      }

      action.status = result.success ? 'completed' : 'failed';
      action.executedAt = new Date();
      action.result = result;

      // Store action
      await this.store.storeAction(action);

      // Emit event
      this.emitAgentEvent(
        result.success ? 'action_completed' : 'action_failed',
        action,
      );

      this.actionsThisHour++;
      this.recordProcessing(Date.now() - startTime, result.success);
      this.incrementCustomMetric(`actions_${action.type}`);

    } catch (error) {
      action.status = 'failed';
      action.result = {
        success: false,
        message: (error as Error).message,
        affectedEntities: [],
      };

      this.emitAgentEvent('action_failed', { action, error: (error as Error).message });
      this.recordProcessing(Date.now() - startTime, false);
      this.recordError(error as Error);
    }

    this.state = 'ready';
    return action;
  }

  private applyRateLimit(principalId: string, action: EnforcerAction): EnforcerActionResult {
    const limitUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    this.rateLimits.set(principalId, {
      principalId,
      limitUntil,
      reason: action.triggeredBy.reason,
      actionId: action.id,
    });

    this.log('info', `Rate limit applied to ${principalId} until ${limitUntil.toISOString()}`);

    return {
      success: true,
      message: `Rate limit applied until ${limitUntil.toISOString()}`,
      affectedEntities: [principalId],
      metadata: { limitUntil },
    };
  }

  private applyBlock(principalId: string, action: EnforcerAction): EnforcerActionResult {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    this.blocks.set(principalId, {
      principalId,
      blockedUntil,
      reason: action.triggeredBy.reason,
      actionId: action.id,
    });

    this.log('warn', `Temporary block applied to ${principalId} until ${blockedUntil.toISOString()}`);

    return {
      success: true,
      message: `Temporarily blocked until ${blockedUntil.toISOString()}`,
      affectedEntities: [principalId],
      metadata: { blockedUntil },
    };
  }

  private async requestMfa(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would trigger MFA via the auth system
    this.log('info', `MFA requested for ${principalId}`);

    // For now, apply rate limit until MFA is completed
    this.rateLimits.set(principalId, {
      principalId,
      limitUntil: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      reason: 'MFA required',
      actionId: action.id,
    });

    return {
      success: true,
      message: 'MFA challenge triggered',
      affectedEntities: [principalId],
    };
  }

  private async alertAdmin(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // Send webhook notification
    if (this.enforcerConfig.webhookUrl) {
      try {
        await fetch(this.enforcerConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'security_alert',
            principalId,
            reason: action.triggeredBy.reason,
            timestamp: new Date().toISOString(),
            actionId: action.id,
          }),
        });
      } catch (error) {
        this.log('error', 'Failed to send webhook alert', error);
      }
    }

    this.log('warn', `Admin alert sent for ${principalId}: ${action.triggeredBy.reason}`);

    return {
      success: true,
      message: 'Admin alert sent',
      affectedEntities: [principalId],
    };
  }

  private async revokeSession(principalId: string, _action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would revoke sessions via the auth system
    this.log('warn', `Session revocation requested for ${principalId}`);

    return {
      success: true,
      message: 'Session revocation request sent',
      affectedEntities: [principalId],
    };
  }

  private async quarantineResource(principalId: string, action: EnforcerAction): Promise<EnforcerActionResult> {
    // In real implementation, this would mark resources as quarantined
    const resourceId = action.triggeredBy.relatedIds.find(id => id.startsWith('resource:'));

    this.log('warn', `Resource quarantine requested: ${resourceId}`);

    return {
      success: true,
      message: 'Resource quarantine request sent',
      affectedEntities: [principalId, resourceId].filter(Boolean) as string[],
    };
  }

  private async escalateReview(principalId: string, _action: EnforcerAction): Promise<EnforcerActionResult> {
    // Create escalation ticket
    this.log('warn', `Escalating for human review: ${principalId}`);

    return {
      success: true,
      message: 'Escalated to human review',
      affectedEntities: [principalId],
    };
  }

  private async sendAlert(action: EnforcerAction, anomaly: Anomaly): Promise<void> {
    if (this.enforcerConfig.webhookUrl) {
      try {
        await fetch(this.enforcerConfig.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'action_pending_approval',
            action,
            anomaly,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        this.log('error', 'Failed to send approval alert', error);
      }
    }
  }

  private canExecuteAction(): boolean {
    return this.actionsThisHour < this.enforcerConfig.maxActionsPerHour;
  }

  private getPriorityForActionType(type: EnforcerActionType): Priority {
    const priorities: Record<EnforcerActionType, Priority> = {
      rate_limit: 'medium',
      temporary_block: 'high',
      require_mfa: 'high',
      alert_admin: 'low',
      revoke_session: 'critical',
      quarantine_resource: 'critical',
      escalate_review: 'medium',
    };
    return priorities[type] || 'medium';
  }

  private startCleanupJob(): void {
    // Clean expired rate limits and blocks every minute
    setInterval(() => {
      const now = new Date();

      for (const [principalId, entry] of this.rateLimits) {
        if (entry.limitUntil <= now) {
          this.rateLimits.delete(principalId);
          this.log('debug', `Rate limit expired for ${principalId}`);
        }
      }

      for (const [principalId, entry] of this.blocks) {
        if (entry.blockedUntil <= now) {
          this.blocks.delete(principalId);
          this.log('debug', `Block expired for ${principalId}`);
        }
      }
    }, 60 * 1000);
  }

  private startHourlyReset(): void {
    setInterval(() => {
      this.actionsThisHour = 0;
      this.lastHourReset = new Date();
    }, 60 * 60 * 1000);
  }
}
