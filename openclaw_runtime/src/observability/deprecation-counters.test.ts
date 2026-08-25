import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deprecationCounters } from "./deprecation-counters.js";

describe("A5 deprecation counters", () => {
  beforeEach(() => deprecationCounters.reset());
  afterEach(() => deprecationCounters.reset());

  it("records plan adoption, ignored plans, and budget exceeded separately", () => {
    deprecationCounters.incrementA5PlanAdopted(8);
    deprecationCounters.incrementA5PlanIgnored(2);
    deprecationCounters.incrementA5BudgetExceeded(1);

    expect(deprecationCounters.snapshot().a5).toEqual({
      planAdoptedCount: 8,
      planIgnoredCount: 2,
      budgetExceededCount: 1,
    });
  });

  it("ignored rate > 20% triggers degrade_to_default_budget through the existing registry", () => {
    deprecationCounters.incrementA5PlanAdopted(79);
    deprecationCounters.incrementA5PlanIgnored(21);
    const result = deprecationCounters.checkBudgetViolation("a5");
    expect(result.violated).toBe(true);
    if (result.violated) {
      expect(result.degrade).toBe("a5_plan_adoption_rate");
      expect(result.action).toBe("degrade_to_default_budget");
    }
  });

  it("ignored rate <= 20% does not degrade", () => {
    deprecationCounters.incrementA5PlanAdopted(80);
    deprecationCounters.incrementA5PlanIgnored(20);
    expect(deprecationCounters.checkBudgetViolation("a5").violated).toBe(false);
  });
});
