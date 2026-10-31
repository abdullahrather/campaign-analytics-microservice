/**
 * src/modules/demo/activity.ts
 *
 * Remembers when someone last used the dashboard.
 */
const ACTIVE_WINDOW_MS = 30_000;

let lastActivity = 0;

export const noteActivity = (): void => {
  lastActivity = Date.now();
};

export const isActive = (): boolean => Date.now() - lastActivity < ACTIVE_WINDOW_MS;
