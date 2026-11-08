// DebugMenu and DrawCeremony render on the dark "cosmic" background, so their
// status bar text must be light to stay readable. Every other route (including
// Me / More and HelpFAQ, which now share the warm parchment surface) uses dark
// status-bar text. Pure module — no react-native import.
export const COSMIC_ROUTE_NAMES: ReadonlySet<string> = new Set(['DebugMenu', 'DrawCeremony']);

export function statusBarStyleForRoute(routeName: string | undefined): 'light' | 'dark' {
  if (routeName !== undefined && COSMIC_ROUTE_NAMES.has(routeName)) return 'light';
  return 'dark';
}
