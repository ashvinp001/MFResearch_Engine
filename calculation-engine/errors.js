/**
 * Typed engine errors so the UI can react to a cause, not parse a message.
 *
 * Input: a code from CAS_ERROR and a human-readable message.
 * Output: an Error subclass carrying `code`.
 */

export const CAS_ERROR = Object.freeze({
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  PASSWORD_INCORRECT: "PASSWORD_INCORRECT",
  UNREADABLE_PDF: "UNREADABLE_PDF",
  NO_TEXT_LAYER: "NO_TEXT_LAYER",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
});

export class CasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CasError";
    this.code = code;
  }
}
