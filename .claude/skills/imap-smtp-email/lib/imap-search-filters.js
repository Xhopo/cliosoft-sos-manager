function splitSearchFilters(options = {}) {
  const clientFilters = {};
  const serverOptions = { ...options };

  if (options.subject) {
    clientFilters.subject = options.subject;
    delete serverOptions.subject;
  }

  if (options.from) {
    clientFilters.from = options.from;
    delete serverOptions.from;
  }

  return {
    serverOptions,
    clientFilters,
  };
}

function hasClientSideHeaderFilters(filters = {}) {
  return Boolean(filters.subject || filters.from);
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesClientSideHeaderFilters(message = {}, filters = {}) {
  const messageSubject = normalizeValue(message.subject);
  const messageFrom = normalizeValue(message.from);

  if (filters.subject && !messageSubject.includes(normalizeValue(filters.subject))) {
    return false;
  }

  if (filters.from && !messageFrom.includes(normalizeValue(filters.from))) {
    return false;
  }

  return true;
}

module.exports = {
  splitSearchFilters,
  hasClientSideHeaderFilters,
  matchesClientSideHeaderFilters,
};
