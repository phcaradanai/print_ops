/**
 * Physical operator troubleshooting guidance dictionary (Impeccable clarify).
 *
 * Translates raw server error codes (e.g., `PRINTER_ACK_TIMEOUT`, `MEDIA_JAM`)
 * into structured physical action steps for floor operators.
 */

export interface ErrorAdvice {
  titleKey: string;
  adviceKey: string;
  actionStepKey: string;
}

export function getErrorAdvice(errorCode?: string): ErrorAdvice | null {
  if (!errorCode) return null;
  const code = errorCode.toUpperCase();

  if (code.includes('TIMEOUT') || code.includes('ACK')) {
    return {
      titleKey: 'errorAdvice.timeout.title',
      adviceKey: 'errorAdvice.timeout.advice',
      actionStepKey: 'errorAdvice.timeout.action',
    };
  }
  if (code.includes('REFUSED') || code.includes('OFFLINE') || code.includes('UNREACHABLE') || code.includes('CONNECT')) {
    return {
      titleKey: 'errorAdvice.connection.title',
      adviceKey: 'errorAdvice.connection.advice',
      actionStepKey: 'errorAdvice.connection.action',
    };
  }
  if (code.includes('JAM')) {
    return {
      titleKey: 'errorAdvice.jam.title',
      adviceKey: 'errorAdvice.jam.advice',
      actionStepKey: 'errorAdvice.jam.action',
    };
  }
  if (code.includes('PAPER') || code.includes('EMPTY') || code.includes('MEDIA')) {
    return {
      titleKey: 'errorAdvice.paper.title',
      adviceKey: 'errorAdvice.paper.advice',
      actionStepKey: 'errorAdvice.paper.action',
    };
  }
  if (code.includes('UNVERIFIED') || code.includes('AMBIGUOUS')) {
    return {
      titleKey: 'errorAdvice.unverified.title',
      adviceKey: 'errorAdvice.unverified.advice',
      actionStepKey: 'errorAdvice.unverified.action',
    };
  }
  if (code.includes('SPOOLER')) {
    return {
      titleKey: 'errorAdvice.spooler.title',
      adviceKey: 'errorAdvice.spooler.advice',
      actionStepKey: 'errorAdvice.spooler.action',
    };
  }

  return {
    titleKey: 'errorAdvice.general.title',
    adviceKey: 'errorAdvice.general.advice',
    actionStepKey: 'errorAdvice.general.action',
  };
}
