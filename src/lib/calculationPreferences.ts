export function calculationChangePolicy(hasSharedPlan: boolean, isOwner: boolean) {
  return {
    persistShared: hasSharedPlan && isOwner,
    overrideSharedDefaults: hasSharedPlan && !isOwner,
  };
}

export function shouldApplySharedCalculationPreferences(
  currentPlanId: string | null,
  incomingPlanId: string,
  locallyOverridden: boolean,
) {
  return currentPlanId !== incomingPlanId || !locallyOverridden;
}
