export function renderPixelRatio(devicePixelRatio: number, viewportScale = 1) {
  // Safari can enlarge the layout viewport when zoomed out. Keep the same
  // on-screen pixel density as at 100%, without increasing cost when zoomed in.
  // An inactive document may report a scale of zero.
  const scale = viewportScale > 0 ? Math.min(viewportScale, 1) : 1;
  return Math.min(devicePixelRatio, 1.8) * scale;
}
