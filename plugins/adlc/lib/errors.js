'use strict';

const EXIT = { OK: 0, USAGE: 1, RULE: 2, CONFLICT: 3, NOINIT: 4, CMD_FAILED: 5 };

class AdlcError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = (message) => new AdlcError(EXIT.USAGE, message);
const rule = (message) => new AdlcError(EXIT.RULE, message);

module.exports = { EXIT, AdlcError, usage, rule };
