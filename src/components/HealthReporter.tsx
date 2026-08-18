'use client';

import { useEffect } from 'react';

import { isHydrationErrorMessage } from '@/lib/hydration-error';

const REPORT_ENDPOINT = '/api/health-event';

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * `crypto.randomUUID()` throws outside a secure context (HTTPS or
 * localhost) -- dev is served over plain HTTP on a LAN IP, which is
 * neither, so this must not be the only path. navigationId is a
 * low-stakes correlation key for the admin view, not a security value,
 * so a Math.random()-based fallback is an acceptable substitute here
 * even though it would not be for anything the server trusts.
 */
function safeRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the Math.random() generator below
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function extractReactErrorCode(message: string): string | null {
  return message.match(/react error #(\d+)/i)?.[1] ?? null;
}

/** The clientRef an answer panel's feedback widget carries, if this page has one (NlAnswerFeedback.tsx). */
function currentClientRef(): string | null {
  return document.querySelector<HTMLInputElement>('input[name="clientRef"]')?.value || null;
}

function report(body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  if (typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(REPORT_ENDPOINT, new Blob([payload], { type: 'application/json' }));
  } else {
    fetch(REPORT_ENDPOINT, {
      method: 'POST',
      body: payload,
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {});
  }
}

/**
 * Site-wide and silent: mounted once from the root layout, renders
 * nothing. Classifies and reports client-observed technical failures --
 * see src/db/queries/app-health.ts for the full taxonomy and why
 * RECOVERABLE_HYDRATION_ERROR is kept distinct from everything else.
 *
 * `window.addEventListener('error', ...)` alone, deliberately not a
 * console.error override: every hydration incident captured during the
 * 2026-08-18 investigation (see project memory) surfaced as a genuine
 * thrown/uncaught error, never as a plain console.error call, so this is
 * the one hook that matches production's actual observed behaviour
 * without monkey-patching a global the rest of the app -- or a future
 * dependency -- might also rely on.
 */
export function HealthReporter() {
  useEffect(() => {
    const navigationId = safeRandomId();
    const startedAt = performance.now();

    function commonFields() {
      return {
        route: window.location.pathname,
        navigationId,
        timeSinceNavigationMs: Math.round(performance.now() - startedAt),
        relatedSearchClientRef: currentClientRef(),
      };
    }

    function onError(event: ErrorEvent) {
      const message = event.error instanceof Error
        ? event.error.message
        : String(event.message || 'unknown error');
      if (isHydrationErrorMessage(message)) {
        report({
          eventType: 'RECOVERABLE_HYDRATION_ERROR',
          reactErrorCode: extractReactErrorCode(message),
          recovered: true,
          detail: truncate(message, 500),
          ...commonFields(),
        });
      } else {
        report({
          eventType: 'UNHANDLED_CLIENT_ERROR',
          detail: truncate(message, 500),
          ...commonFields(),
        });
      }
    }

    function onRejection(event: PromiseRejectionEvent) {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
      report({
        eventType: 'UNHANDLED_CLIENT_ERROR',
        detail: truncate(`unhandled rejection: ${message}`, 500),
        ...commonFields(),
      });
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
