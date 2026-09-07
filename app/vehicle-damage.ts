export function createVehicleDamage() {
  return { amount: 0, impactPeak: 0, impactTime: 0 };
}

function impactDamage(speed: number) {
  // Ignore parking-speed nudges; harder impacts grow more costly with speed.
  const excess = Math.max(0, speed - 1.5);
  return excess * 0.8 + excess * excess * 0.18;
}

export function advanceVehicleDamage(
  damage: ReturnType<typeof createVehicleDamage>,
  closingSpeed: number,
  dt: number,
) {
  damage.impactTime = Math.max(0, damage.impactTime - dt);
  if (damage.impactTime === 0) damage.impactPeak = 0;
  if (closingSpeed <= 1.5) return;

  // The two body colliders can hit over several ticks. Count one crash once,
  // but still account for a stronger follow-up impact during that crash.
  if (closingSpeed > damage.impactPeak) {
    damage.amount = Math.min(
      100,
      damage.amount +
        impactDamage(closingSpeed) -
        impactDamage(damage.impactPeak),
    );
    damage.impactPeak = closingSpeed;
  }
  damage.impactTime = 0.2;
}
