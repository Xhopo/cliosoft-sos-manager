const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const {
  getStoredEmailSecrets,
  MANAGEMENT_API_UNAVAILABLE_MESSAGE,
} = require('./email-credentials-client');
const {
  EmailSkillError,
  buildConfigureHint,
  buildSecretHint,
  buildCps163Hint,
} = require('./email-errors');

const SKILL_ENV_PATH = path.resolve(__dirname, '../.env');

const SAFE_ENV_KEYS = new Set([
  'EMAIL_SKILL_DEBUG',
  'EMAIL_PROVIDER',
  'IMAP_HOST',
  'IMAP_PORT',
  'IMAP_TLS',
  'IMAP_USER',
  'IMAP_REJECT_UNAUTHORIZED',
  'IMAP_MAILBOX',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_FROM',
  'SMTP_REJECT_UNAUTHORIZED',
]);

const PROVIDER_PRESETS = {
  'cps-163-enterprise': {
    providerId: 'cps-163-enterprise',
    displayName: 'CPS 163 Enterprise Mail',
    imap: { host: 'imap.qiye.163.com', port: 993, tls: true },
    smtp: { host: 'smtp.qiye.163.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  '163-enterprise': {
    providerId: '163-enterprise',
    displayName: '163 Enterprise Mail',
    imap: { host: 'imap.qiye.163.com', port: 993, tls: true },
    smtp: { host: 'smtp.qiye.163.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  '163.com': {
    providerId: '163.com',
    displayName: '163 Mail',
    imap: { host: 'imap.163.com', port: 993, tls: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  'vip.163.com': {
    providerId: 'vip.163.com',
    displayName: 'vip.163 Mail',
    imap: { host: 'imap.vip.163.com', port: 993, tls: true },
    smtp: { host: 'smtp.vip.163.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  '126.com': {
    providerId: '126.com',
    displayName: '126 Mail',
    imap: { host: 'imap.126.com', port: 993, tls: true },
    smtp: { host: 'smtp.126.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  'vip.126.com': {
    providerId: 'vip.126.com',
    displayName: 'vip.126 Mail',
    imap: { host: 'imap.vip.126.com', port: 993, tls: true },
    smtp: { host: 'smtp.vip.126.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  '188.com': {
    providerId: '188.com',
    displayName: '188 Mail',
    imap: { host: 'imap.188.com', port: 993, tls: true },
    smtp: { host: 'smtp.188.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  'vip.188.com': {
    providerId: 'vip.188.com',
    displayName: 'vip.188 Mail',
    imap: { host: 'imap.vip.188.com', port: 993, tls: true },
    smtp: { host: 'smtp.vip.188.com', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  'yeah.net': {
    providerId: 'yeah.net',
    displayName: 'yeah.net Mail',
    imap: { host: 'imap.yeah.net', port: 993, tls: true },
    smtp: { host: 'smtp.yeah.net', port: 465, secure: true },
    mailbox: 'INBOX',
  },
  gmail: {
    providerId: 'gmail',
    displayName: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, tls: true },
    smtp: { host: 'smtp.gmail.com', port: 587, secure: false },
    mailbox: 'INBOX',
  },
  outlook: {
    providerId: 'outlook',
    displayName: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993, tls: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    mailbox: 'INBOX',
  },
  qq: {
    providerId: 'qq',
    displayName: 'QQ Mail',
    imap: { host: 'imap.qq.com', port: 993, tls: true },
    smtp: { host: 'smtp.qq.com', port: 587, secure: false },
    mailbox: 'INBOX',
  },
};

const PROVIDER_ALIASES = {
  cps: 'cps-163-enterprise',
  convenientpower: 'cps-163-enterprise',
  'convenientpower.com': 'cps-163-enterprise',
  'cps-163-enterprise': 'cps-163-enterprise',
  '163-enterprise': '163-enterprise',
  '163 enterprise': '163-enterprise',
  qiye163: '163-enterprise',
  '163-qiye': '163-enterprise',
  '163.com': '163.com',
  'vip.163.com': 'vip.163.com',
  '126.com': '126.com',
  'vip.126.com': 'vip.126.com',
  '188.com': '188.com',
  'vip.188.com': 'vip.188.com',
  'yeah.net': 'yeah.net',
  gmail: 'gmail',
  google: 'gmail',
  outlook: 'outlook',
  office365: 'outlook',
  qq: 'qq',
};

const DOMAIN_PROVIDER_MAP = {
  'convenientpower.com': 'cps-163-enterprise',
  '163.com': '163.com',
  'vip.163.com': 'vip.163.com',
  '126.com': '126.com',
  'vip.126.com': 'vip.126.com',
  '188.com': '188.com',
  'vip.188.com': 'vip.188.com',
  'yeah.net': 'yeah.net',
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'office365.com': 'outlook',
  'qq.com': 'qq',
};

const ORDERED_ENV_GROUPS = [
  ['EMAIL_PROVIDER', 'EMAIL_SKILL_DEBUG'],
  ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_TLS', 'IMAP_REJECT_UNAUTHORIZED', 'IMAP_MAILBOX'],
  ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_FROM', 'SMTP_REJECT_UNAUTHORIZED'],
];

function loadSkillEnv(envPath = SKILL_ENV_PATH) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
  const filtered = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (SAFE_ENV_KEYS.has(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

function writeSkillEnv(settings, envPath = SKILL_ENV_PATH) {
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = [];
  for (const group of ORDERED_ENV_GROUPS) {
    if (lines.length > 0) {
      lines.push('');
    }

    for (const key of group) {
      if (!SAFE_ENV_KEYS.has(key)) {
        continue;
      }
      if (settings[key] == null || settings[key] === '') {
        continue;
      }
      lines.push(`${key}=${settings[key]}`);
    }
  }

  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
}

function getSetting(key, env = process.env, skillEnv = {}) {
  return env[key] ?? skillEnv[key];
}

function isExplicitTrue(value, defaultValue = false) {
  if (value == null) {
    return defaultValue;
  }

  return String(value).toLowerCase() === 'true';
}

function isPresent(value) {
  return typeof value === 'string' && value.length > 0;
}

function parsePort(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProviderKey(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');

  return PROVIDER_ALIASES[normalized] || null;
}

function inferProviderFromEmail(email) {
  if (!isPresent(email) || !email.includes('@')) {
    return null;
  }

  const domain = email.split('@').pop().trim().toLowerCase();
  return DOMAIN_PROVIDER_MAP[domain] || null;
}

function resolveProviderContext({
  env = process.env,
  skillEnv = loadSkillEnv(),
  provider,
  email,
} = {}) {
  const explicitProvider = provider || getSetting('EMAIL_PROVIDER', env, skillEnv);
  const resolvedEmail = email
    || getSetting('IMAP_USER', env, skillEnv)
    || getSetting('SMTP_USER', env, skillEnv)
    || null;

  let providerKey = null;

  if (explicitProvider) {
    providerKey = normalizeProviderKey(explicitProvider);
    if (!providerKey) {
      throw new EmailSkillError(
        'EMAIL_CONFIG_MISSING',
        `Unsupported EMAIL_PROVIDER "${explicitProvider}".`,
        `${buildCps163Hint()} ${buildConfigureHint()}`
      );
    }
  } else {
    providerKey = inferProviderFromEmail(resolvedEmail);
  }

  return {
    providerKey,
    preset: providerKey ? PROVIDER_PRESETS[providerKey] : null,
    email: resolvedEmail,
  };
}

function inspectResolvedConfig({
  env = process.env,
  skillEnv = loadSkillEnv(),
  provider,
  email,
} = {}) {
  const providerContext = resolveProviderContext({ env, skillEnv, provider, email });
  const missing = [];
  const imapUser = getSetting('IMAP_USER', env, skillEnv) || providerContext.email || undefined;
  const smtpUser = getSetting('SMTP_USER', env, skillEnv) || providerContext.email || undefined;
  const imapHost = getSetting('IMAP_HOST', env, skillEnv) || providerContext.preset?.imap.host;
  const smtpHost = getSetting('SMTP_HOST', env, skillEnv) || providerContext.preset?.smtp.host;
  const imapPort = parsePort(getSetting('IMAP_PORT', env, skillEnv), providerContext.preset?.imap.port);
  const smtpPort = parsePort(getSetting('SMTP_PORT', env, skillEnv), providerContext.preset?.smtp.port);
  const imapSecure = isExplicitTrue(
    getSetting('IMAP_TLS', env, skillEnv),
    providerContext.preset?.imap.tls ?? imapPort === 993
  );
  const smtpSecure = isExplicitTrue(
    getSetting('SMTP_SECURE', env, skillEnv),
    providerContext.preset?.smtp.secure ?? smtpPort === 465
  );

  if (!isPresent(imapUser)) {
    missing.push('IMAP_USER');
  }
  if (!isPresent(smtpUser)) {
    missing.push('SMTP_USER');
  }
  if (!isPresent(imapHost)) {
    missing.push('IMAP_HOST');
  }
  if (!isPresent(smtpHost)) {
    missing.push('SMTP_HOST');
  }

  return {
    providerKey: providerContext.providerKey,
    preset: providerContext.preset,
    email: providerContext.email,
    missing,
    imap: {
      host: imapHost,
      port: imapPort,
      user: imapUser,
      secure: imapSecure,
      rejectUnauthorized: getSetting('IMAP_REJECT_UNAUTHORIZED', env, skillEnv) !== 'false',
      mailbox: getSetting('IMAP_MAILBOX', env, skillEnv) || providerContext.preset?.mailbox || 'INBOX',
    },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      user: smtpUser,
      secure: smtpSecure,
      rejectUnauthorized: getSetting('SMTP_REJECT_UNAUTHORIZED', env, skillEnv) !== 'false',
      from: getSetting('SMTP_FROM', env, skillEnv) || smtpUser,
    },
  };
}

function buildConfigHint(snapshot) {
  const isCpsMailbox = snapshot.providerKey === 'cps-163-enterprise'
    || (snapshot.email || '').toLowerCase().endsWith('@convenientpower.com');
  const provider = snapshot.providerKey || (isCpsMailbox ? 'cps-163-enterprise' : '163-enterprise');
  const email = snapshot.email || (isCpsMailbox ? 'your.name@convenientpower.com' : 'mailbox@example.com');
  const baseHint = isCpsMailbox
    ? buildCps163Hint()
    : 'Set EMAIL_PROVIDER or explicit IMAP/SMTP host settings before using the mailbox.';

  return `${baseHint} ${buildConfigureHint({ provider, email })}`;
}

function getDebugEnabled(env = process.env, skillEnv = {}) {
  return isExplicitTrue(getSetting('EMAIL_SKILL_DEBUG', env, skillEnv), false);
}

async function resolveSecret({
  envKey,
  storedKey,
  env = process.env,
  loadStoredSecrets = () => getStoredEmailSecrets(env),
  providerHint,
}) {
  const directValue = env[envKey];
  if (isPresent(directValue)) {
    return directValue;
  }

  let storedSecrets = {};
  try {
    storedSecrets = await loadStoredSecrets();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(MANAGEMENT_API_UNAVAILABLE_MESSAGE)) {
      throw error;
    }
  }

  const storedValue = storedSecrets?.[storedKey];
  if (isPresent(storedValue)) {
    return storedValue;
  }

  throw new EmailSkillError(
    'EMAIL_SECRET_MISSING',
    `Missing ${envKey}. No stored authorization code is available for this mailbox.`,
    providerHint || buildSecretHint(envKey)
  );
}

async function createImapConfig({
  env = process.env,
  skillEnv = loadSkillEnv(),
  loadStoredSecrets,
} = {}) {
  const snapshot = inspectResolvedConfig({ env, skillEnv });

  if (!isPresent(snapshot.imap.user)) {
    throw new EmailSkillError(
      'EMAIL_CONFIG_MISSING',
      'Missing IMAP_USER. Provide the full mailbox address before checking mail.',
      buildConfigHint(snapshot)
    );
  }

  if (!isPresent(snapshot.imap.host)) {
    throw new EmailSkillError(
      'EMAIL_CONFIG_MISSING',
      'Missing IMAP_HOST. Set EMAIL_PROVIDER or IMAP_HOST before checking mail.',
      buildConfigHint(snapshot)
    );
  }

  return {
    host: snapshot.imap.host,
    port: snapshot.imap.port,
    secure: snapshot.imap.secure,
    auth: {
      user: snapshot.imap.user,
      pass: await resolveSecret({
        envKey: 'IMAP_PASS',
        storedKey: 'imapPass',
        env,
        loadStoredSecrets,
        providerHint: buildConfigHint(snapshot),
      }),
    },
    tls: {
      rejectUnauthorized: snapshot.imap.rejectUnauthorized,
    },
    mailbox: snapshot.imap.mailbox,
  };
}

async function createSmtpConfig({
  env = process.env,
  skillEnv = loadSkillEnv(),
  loadStoredSecrets,
} = {}) {
  const snapshot = inspectResolvedConfig({ env, skillEnv });

  if (!isPresent(snapshot.smtp.user)) {
    throw new EmailSkillError(
      'EMAIL_CONFIG_MISSING',
      'Missing SMTP_USER. Provide the full mailbox address before sending mail.',
      buildConfigHint(snapshot)
    );
  }

  if (!isPresent(snapshot.smtp.host)) {
    throw new EmailSkillError(
      'EMAIL_CONFIG_MISSING',
      'Missing SMTP_HOST. Set EMAIL_PROVIDER or SMTP_HOST before sending mail.',
      buildConfigHint(snapshot)
    );
  }

  return {
    host: snapshot.smtp.host,
    port: snapshot.smtp.port,
    secure: snapshot.smtp.secure,
    auth: {
      user: snapshot.smtp.user,
      pass: await resolveSecret({
        envKey: 'SMTP_PASS',
        storedKey: 'smtpPass',
        env,
        loadStoredSecrets,
        providerHint: buildConfigHint(snapshot),
      }),
    },
    tls: {
      rejectUnauthorized: snapshot.smtp.rejectUnauthorized,
    },
    from: snapshot.smtp.from,
  };
}

module.exports = {
  SKILL_ENV_PATH,
  PROVIDER_PRESETS,
  loadSkillEnv,
  writeSkillEnv,
  resolveProviderContext,
  inspectResolvedConfig,
  getDebugEnabled,
  createImapConfig,
  createSmtpConfig,
};
