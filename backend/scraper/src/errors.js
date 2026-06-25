/**
 * Custom structured error taxonomy.
 * These carry machine-readable codes + context so the monitoring hook
 * can distinguish a transient navigation failure from an actual
 * DOM structure mutation on the upstream portal.
 */

export class ScrapeError extends Error {
  constructor(message, { code = 'SCRAPE_ERROR', stage = 'unknown', context = {} } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.stage = stage;
    this.context = context;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace?.(this, this.constructor);
  }

  toStructured() {
    return {
      name: this.name,
      code: this.code,
      stage: this.stage,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Thrown when an expected selector/element is missing — i.e. the
 * upstream DOM contract was broken (table/th/td/anchor not found).
 */
export class DomMutationError extends ScrapeError {
  constructor(message, context = {}) {
    super(message, { code: 'DOM_MUTATION', stage: 'harvest', context });
  }
}

/** Thrown when authentication does not land on the expected post-login state. */
export class AuthError extends ScrapeError {
  constructor(message, context = {}) {
    super(message, { code: 'AUTH_FAILURE', stage: 'login', context });
  }
}
