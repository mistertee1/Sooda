/**
 * Workflow Architecture Foundation
 * Inspired by resilient orchestration patterns (e.g. Medusa Workflows SDK / Saga pattern).
 * 
 * ARCHITECTURAL CLASSIFICATION:
 * - STATUS: FOUNDATION / ARCHITECTURAL BLUEPRINT (ENGINE IMPLEMENTATION).
 * - ENGINE SCOPE: Generic workflow execution engine, ordered step pipeline, failure handling,
 *   two-phase compensation/rollback, trace ID propagation, and audit event integration.
 * - FUTURE PHASES: Specific domain business workflows (e.g., Cart, Checkout, Order Processing,
 *   Subscription Billing, Inventory Allocations) belong strictly to future phases (Phase 1+).
 *   This file provides the resilient engine abstractions, NOT completed business domain modules.
 * - NO DEMO IDENTIFIERS: All demo/sample mocks removed in favor of typed engine contracts.
 */

import { AuditLogService, AuditAction } from '../observability/index.ts';

export interface WorkflowContext {
  traceId: string;
  tenantId?: string;
  actorId?: string;
  stepData: Record<string, unknown>;
  startTime: number;
}

export interface WorkflowStep<TInput, TOutput> {
  name: string;
  execute: (input: TInput, context: WorkflowContext) => Promise<TOutput> | TOutput;
  compensate?: (input: TInput, output: TOutput | undefined, context: WorkflowContext) => Promise<void> | void;
}

export interface WorkflowExecutionResult<TOutput> {
  success: boolean;
  data?: TOutput;
  error?: string;
  executedSteps: string[];
  compensatedSteps: string[];
  durationMs: number;
}

export class Workflow<TInput, TOutput> {
  public readonly name: string;
  private readonly steps: WorkflowStep<any, any>[] = [];

  constructor(name: string) {
    this.name = name;
  }

  public step<TStepInput, TStepOutput>(
    step: WorkflowStep<TStepInput, TStepOutput>
  ): this {
    this.steps.push(step);
    return this;
  }

  public async run(
    initialInput: TInput,
    contextSeed?: Partial<WorkflowContext>
  ): Promise<WorkflowExecutionResult<TOutput>> {
    const startTime = performance.now();
    const context: WorkflowContext = {
      traceId: contextSeed?.traceId || `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenantId: contextSeed?.tenantId,
      actorId: contextSeed?.actorId,
      stepData: { ...contextSeed?.stepData },
      startTime: Date.now(),
    };

    const executedSteps: Array<{ step: WorkflowStep<any, any>; input: any; output: any }> = [];
    const compensatedSteps: string[] = [];

    let currentInput: any = initialInput;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      try {
        const output = await step.execute(currentInput, context);
        executedSteps.push({ step, input: currentInput, output });
        context.stepData[step.name] = output;
        currentInput = output;
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        
        // Execute compensations in strict reverse order for already completed steps
        for (let j = executedSteps.length - 1; j >= 0; j--) {
          const executed = executedSteps[j];
          if (executed.step.compensate) {
            try {
              await executed.step.compensate(executed.input, executed.output, context);
              compensatedSteps.push(executed.step.name);
            } catch (compErr) {
              console.error(`[Workflow:${this.name}] Compensation failed on step ${executed.step.name}:`, compErr);
            }
          }
        }

        // Log failure to cryptographically chained audit log
        try {
          AuditLogService.getInstance().record({
            tenantId: context.tenantId || undefined,
            actorId: context.actorId || 'system',
            actorRole: 'SYSTEM_WORKFLOW',
            action: AuditAction.WORKFLOW_FAILED_COMPENSATED,
            resource: `Workflow:${this.name}`,
            entityType: 'Workflow',
            entityId: this.name,
            result: 'FAILED',
            traceId: context.traceId,
            metadata: {
              failedStep: step.name,
              error: errorMessage,
              compensatedSteps,
            },
          });
        } catch {
          // Keep failure handling robust
        }

        return {
          success: false,
          error: `Step '${step.name}' failed: ${errorMessage}`,
          executedSteps: executedSteps.map((s) => s.step.name),
          compensatedSteps,
          durationMs: Math.round(performance.now() - startTime),
        };
      }
    }

    return {
      success: true,
      data: currentInput as TOutput,
      executedSteps: executedSteps.map((s) => s.step.name),
      compensatedSteps: [],
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

/**
 * Workflow Blueprint Engine Contract
 * 
 * ARCHITECTURAL SPECIFICATION:
 * Defines the contract that future domain workflows (in Phase 1+) must adhere to.
 */
export interface IWorkflowBlueprint<TInput, TOutput> {
  readonly workflowName: string;
  createInstance(): Workflow<TInput, TOutput>;
}

/**
 * Generic Pipeline Builder
 * Utility to compose workflow instances from ordered step definitions.
 */
export function createWorkflowPipeline<TInput, TOutput>(
  name: string,
  steps: WorkflowStep<any, any>[]
): Workflow<TInput, TOutput> {
  const workflow = new Workflow<TInput, TOutput>(name);
  for (const step of steps) {
    workflow.step(step);
  }
  return workflow;
}

