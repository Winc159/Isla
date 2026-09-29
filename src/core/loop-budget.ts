export const DEFAULT_INITIAL_STEP_BUDGET = 12;
export const DEFAULT_EXTENSION_STEPS = 8;
export const DEFAULT_AUTO_STEP_LIMIT = 28;
export const DEFAULT_HARD_STEP_LIMIT = 40;

export interface LoopProgressSample { readonly action: string; readonly result: string; readonly changed: boolean; readonly errorCode?: string; }

export class LoopBudgetState {
  private budget = DEFAULT_INITIAL_STEP_BUDGET;
  private readonly samples: LoopProgressSample[] = [];
  constructor(private readonly hardLimit = DEFAULT_HARD_STEP_LIMIT, private readonly autoLimit = DEFAULT_AUTO_STEP_LIMIT) {}
  get currentBudget(): number { return this.budget; }
  get samplesWindow(): readonly LoopProgressSample[] { return this.samples.slice(-6); }
  record(sample: LoopProgressSample): void { this.samples.push(sample); }
  isStuck(): boolean { const recent = this.samples.slice(-3); if (recent.length < 3) return false; const same = recent.every(item => item.action === recent[0]!.action && item.result === recent[0]!.result); const errors = recent.every(item => item.errorCode && item.errorCode === recent[0]!.errorCode); return same || errors; }
  hasAlternatingLoop(): boolean {
    const recent = this.samples.slice(-6);
    if (recent.length < 4) return false;
    const a = recent[0]!, b = recent[1]!;
    if (a.action === b.action && a.result === b.result) return false;
    return recent.every((item, index) => {
      const expected = index % 2 === 0 ? a : b;
      return item.action === expected.action && item.result === expected.result;
    });
  }
  hasRepeatedFailure(): boolean {
    const recent = this.samples.slice(-6);
    const failures = recent.filter(item => Boolean(item.errorCode));
    if (failures.length < 3) return false;
    const first = failures[0]!;
    return failures.filter(item => item.action.split(':', 1)[0] === first.action.split(':', 1)[0] && item.errorCode === first.errorCode).length >= 3;
  }
  shouldStop(): boolean { return this.isStuck() || this.hasAlternatingLoop() || this.hasRepeatedFailure(); }
  tryExtend(): boolean { if (this.shouldStop() || this.budget >= Math.min(this.autoLimit, this.hardLimit)) return false; this.budget = Math.min(this.budget + DEFAULT_EXTENSION_STEPS, this.autoLimit, this.hardLimit); return true; }
  extendAfterApproval(): boolean { if (this.shouldStop() || this.budget >= this.hardLimit) return false; this.budget = Math.min(this.budget + DEFAULT_EXTENSION_STEPS, this.hardLimit); return true; }
  hardStopReached(): boolean { return this.budget >= this.hardLimit; }
}
