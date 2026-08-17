import type { ReactElement } from 'react';

/**
 * The setup guide's completion, as a ring.
 *
 * Drawn here rather than imported: Polaris has no ring, and
 * `@shopify/polaris-icons` — while present in node_modules — is not a declared
 * dependency of this app. Reaching for a package that only happens to be
 * hoisted is a build that breaks on someone else's machine for no reason they
 * can see.
 *
 * A circle's stroke is dashed from its top by rotating it a quarter turn, so
 * `strokeDasharray` measures progress from twelve o'clock the way a merchant
 * reads it.
 */
const SIZE = 32;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ProgressRing({
  completed,
  total,
}: {
  completed: number;
  total: number;
}): ReactElement {
  const fraction = total === 0 ? 0 : completed / total;

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${completed} of ${total} steps completed`}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--p-color-border)"
        strokeWidth={STROKE}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--p-color-icon)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}

/** A step's state: a filled tick when done, a dashed outline when not. */
export function StepMarker({ done }: { done: boolean }): ReactElement {
  if (!done) {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="var(--p-color-border)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--p-color-icon)" />
      <path
        d="M6 10.5l2.5 2.5L14 7.5"
        fill="none"
        stroke="var(--p-color-bg-surface)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
