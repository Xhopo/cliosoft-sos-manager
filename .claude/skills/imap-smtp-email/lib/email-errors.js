const DEFAULT_CPS_PROVIDER = 'cps-163-enterprise';
const DEFAULT_CPS_EMAIL = 'your.name@convenientpower.com';

class EmailSkillError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = 'EmailSkillError';
    this.code = code;
    this.hint = hint;
  }
}

function isEmailSkillError(error) {
  return error instanceof EmailSkillError;
}

function buildConfigureCommand({
  provider = DEFAULT_CPS_PROVIDER,
  email = DEFAULT_CPS_EMAIL,
  authCode = '<163_authorization_code>',
  runtime = 'bun',
} = {}) {
  const normalizedEmail = email || DEFAULT_CPS_EMAIL;
  const normalizedProvider = provider || DEFAULT_CPS_PROVIDER;

  if (runtime === 'node') {
    return `node scripts/configure.js apply --provider ${normalizedProvider} --email ${normalizedEmail} --auth-code ${authCode}`;
  }

  return `bun --no-env-file --bun scripts/configure.js apply --provider ${normalizedProvider} --email ${normalizedEmail} --auth-code ${authCode}`;
}

function buildConfigureHint({
  provider = DEFAULT_CPS_PROVIDER,
  email = DEFAULT_CPS_EMAIL,
} = {}) {
  const bunCommand = buildConfigureCommand({ provider, email, runtime: 'bun' });
  const nodeCommand = buildConfigureCommand({ provider, email, runtime: 'node' });

  return `Run "${bunCommand}" inside MyAgents. If Bun is unavailable, fall back to "${nodeCommand}".`;
}

function buildSecretHint(envKey) {
  return `Run "bun --no-env-file --bun scripts/credentials.js set" inside MyAgents, or set ${envKey} in the current environment. If Bun is unavailable, fall back to "node scripts/credentials.js set".`;
}

function buildCps163Hint() {
  return 'For CPS mailboxes, use the full @convenientpower.com address plus the 163 enterprise authorization code. Confirm IMAP/SMTP is enabled in 163 enterprise webmail first.';
}

function formatEmailSkillError(error) {
  const lines = [`[${error.code}] ${error.message}`];
  if (error.hint) {
    lines.push(`Hint: ${error.hint}`);
  }
  return lines.join('\n');
}

function capitalizeProtocol(protocol) {
  if (!protocol) {
    return 'Email';
  }

  const upper = String(protocol).toUpperCase();
  if (upper === 'IMAP' || upper === 'SMTP') {
    return upper;
  }

  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function normalizeRuntimeEmailError(error, { protocol = 'email', hint } = {}) {
  if (isEmailSkillError(error)) {
    return error;
  }

  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  const message = error.message || String(error);
  const lower = message.toLowerCase();
  const effectiveHint = hint || buildCps163Hint();
  const prefix = capitalizeProtocol(protocol);

  const authPatterns = [
    /auth/i,
    /authentication/i,
    /invalid login/i,
    /login failed/i,
    /username and password not accepted/i,
    /\b535\b/,
    /eauth/i,
    /AUTHENTICATIONFAILED/i,
    /application-specific password/i,
  ];

  if (authPatterns.some((pattern) => pattern.test(message))) {
    return new EmailSkillError(
      'EMAIL_AUTH_FAILED',
      `${prefix} authentication failed. ${message}`,
      effectiveHint
    );
  }

  const connectionPatterns = [
    /timeout/i,
    /timed out/i,
    /econnrefused/i,
    /ehostunreach/i,
    /enetunreach/i,
    /enotfound/i,
    /certificate/i,
    /tls/i,
    /ssl/i,
    /socket/i,
    /connection/i,
    /unable to verify/i,
    /greeting never received/i,
    /proxy/i,
  ];

  if (connectionPatterns.some((pattern) => pattern.test(lower))) {
    return new EmailSkillError(
      'EMAIL_CONNECTION_FAILED',
      `${prefix} connection failed. ${message}`,
      effectiveHint
    );
  }

  return error;
}

module.exports = {
  DEFAULT_CPS_PROVIDER,
  DEFAULT_CPS_EMAIL,
  EmailSkillError,
  isEmailSkillError,
  buildConfigureCommand,
  buildConfigureHint,
  buildSecretHint,
  buildCps163Hint,
  formatEmailSkillError,
  normalizeRuntimeEmailError,
};
