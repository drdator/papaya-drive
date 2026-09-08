// Shared by the ocean surface and its foam so the visible waterline stays aligned.
export const shorelineSwellShader = `
float shorelinePhase(vec2 p, float time) {
  float angle = atan(p.y, p.x);
  return time * 0.8 + angle * 3.0 + 0.22 * sin(angle * 11.0);
}
float shorelineSwell(vec2 p, float depth, float time) {
  float coastal = 1.0 - smoothstep(1.5, 5.0, abs(depth));
  return 0.55 * coastal * sin(shorelinePhase(p, time));
}
float smallWaterRipples(vec2 p, float depth, float time) {
  return smoothstep(0.0, 2.0, depth) * (
    0.055 * sin(dot(p, vec2(0.45, 0.21)) - time * 0.65) +
    0.028 * sin(dot(p, vec2(-0.28, 0.52)) - time * 0.47));
}
`;

// CPU equivalent of the water shader for floating scenery.
export function waterSurfaceOffset(
  x: number,
  z: number,
  depth: number,
  time: number,
) {
  const smooth = (a: number, b: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const angle = Math.atan2(z, x);
  const phase = time * 0.8 + angle * 3 + 0.22 * Math.sin(angle * 11);
  return (
    0.55 * (1 - smooth(1.5, 5, Math.abs(depth))) * Math.sin(phase) +
    smooth(0, 2, depth) *
      (0.055 * Math.sin(x * 0.45 + z * 0.21 - time * 0.65) +
        0.028 * Math.sin(x * -0.28 + z * 0.52 - time * 0.47))
  );
}
