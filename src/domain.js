export const WEIGHTS = { schedule_impact: 0.35, budget_impact: 0.25, resource_availability: 0.20, creative_continuity: 0.10, historical_success: 0.10 };

export const STRATEGIES = {
  reorder: { label: 'Re-sequence critical scenes', baseCost: 450000, daysSaved: 2.2, resource: 91, continuity: 93 },
  relocate: { label: 'Relocate affected scenes', baseCost: 1250000, daysSaved: 1.7, resource: 76, continuity: 72 },
  split_unit: { label: 'Split-unit recovery', baseCost: 850000, daysSaved: 2.6, resource: 69, continuity: 82 }
};

export function validateScenario(s) {
  const required = ['scenario_id','production','shoot_day','affected_scenes','crew_count','lead_actor_available_until','estimated_cost_per_delayed_day_ngn'];
  for (const key of required) if (s?.[key] === undefined) throw new Error(`Invalid scenario: missing ${key}`);
  if (!Array.isArray(s.affected_scenes) || !s.affected_scenes.length) throw new Error('Invalid scenario: affected_scenes must be non-empty');
  if (!s.incident?.type) throw new Error('Invalid scenario: incident.type is required');
  return s;
}

function scheduleScore(days) { return Math.max(0, Math.min(100, days * 50)); }
function budgetScore(cost, delayCost) { return delayCost <= 0 ? 50 : Math.max(0, Math.min(100, ((delayCost - cost) / delayCost) * 100)); }

export function rankPlans(scenario, evidence) {
  const historical = evidence.historical_success ?? { reorder: 88, relocate: 73, split_unit: 81 };
  const plans = Object.entries(STRATEGIES).map(([strategy, meta]) => {
    const success = Number(historical[strategy] ?? 70);
    const adjustedDays = Math.max(0.5, meta.daysSaved + Number(evidence.strategy_adjustments?.[strategy]?.days_saved ?? 0));
    const adjustedCost = Math.max(0, meta.baseCost + Number(evidence.strategy_adjustments?.[strategy]?.cost_ngn ?? 0));
    const breakdown = {
      schedule_impact: scheduleScore(adjustedDays),
      budget_impact: budgetScore(adjustedCost, scenario.estimated_cost_per_delayed_day_ngn),
      resource_availability: meta.resource,
      creative_continuity: meta.continuity,
      historical_success: Math.max(0, Math.min(100, success))
    };
    const score = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + breakdown[k] * w, 0);
    const rationale = strategy === 'reorder'
      ? `Protects the lead-actor window while avoiding the largest relocation cost; historical recovery success is ${success}%.`
      : strategy === 'relocate'
      ? `Removes the location dependency but carries a higher transition cost and lower creative continuity; historical success is ${success}%.`
      : `Parallelizes work to save the most schedule time, but needs more crew coordination; historical success is ${success}%.`;
    return {
      rank: 0, strategy, label: meta.label, score: Number(score.toFixed(2)), rationale,
      actions: strategy === 'reorder'
        ? ['Lock the replacement scene order', 'Move scenes 42–45 behind the critical interior block', 'Reconfirm actor call sheet before 18:00']
        : strategy === 'relocate'
        ? ['Confirm replacement location', 'Transfer essential production resources', 'Reblock affected scenes and update call sheet']
        : ['Assign second unit lead', 'Split scenes by dependency', 'Run parallel continuity and safety checks'],
      schedule_days_saved: Number(adjustedDays.toFixed(1)), estimated_cost_ngn: adjustedCost,
      score_breakdown: Object.fromEntries(Object.entries(breakdown).map(([k,v]) => [k, Number(v.toFixed(2))]))
    };
  }).sort((a,b) => b.score - a.score || a.estimated_cost_ngn - b.estimated_cost_ngn || a.strategy.localeCompare(b.strategy));
  plans.forEach((p,i) => p.rank = i + 1);
  return plans;
}
