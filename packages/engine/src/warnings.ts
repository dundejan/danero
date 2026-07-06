export type WarningLevel = 'INFO' | 'WARNING' | 'ERROR';

/**
 * Kódovaná upozornění enginu — každé výkladově nejisté nebo problematické místo
 * výpočtu se propíše do výsledku, aby bylo v UI/reportu dohledatelné a průkazné.
 */
export interface EngineWarning {
  code: string;
  level: WarningLevel;
  message: string;
  context?: Record<string, unknown>;
}

export class WarningCollector {
  readonly items: EngineWarning[] = [];

  add(code: string, level: WarningLevel, message: string, context?: Record<string, unknown>): void {
    this.items.push(context ? { code, level, message, context } : { code, level, message });
  }

  has(code: string): boolean {
    return this.items.some((w) => w.code === code);
  }
}

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
