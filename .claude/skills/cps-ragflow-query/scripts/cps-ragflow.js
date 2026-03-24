const {
  getCpsAuthStatus,
  listRagflowDatasets: listRagflowDatasetsFromApi,
  queryRagflowRetrieval,
} = require('../lib/management-api-client.js');

const DATASET_CACHE_TTL_MS = 10 * 60 * 1000;
const DATASET_PAGE_SIZE = 7;
const DATASET_PAGE_SIZE_MIN = 2;
const DATASET_PAGE_SIZE_MAX = 15;
const DATASET_CATALOG_PAGE_SIZE = 30;
const DEFAULT_QUERY_PAGE_SIZE = 8;
const DEFAULT_QUERY_TOP_K = 100;
const MAX_TOP_ITEMS = 10;
const BUN_RUNTIME_PREFIX = 'bun --no-env-file --bun';
const NODE_RUNTIME_PREFIX = 'node';

const KNOWN_DATASET_ENTRIES = Object.freeze([
  { id: '0a5b29881d3311f184fc8144b17022b7', name: 'WPT Patents' },
  { id: '25bad7be1b8a11f184fc8144b17022b7', name: 'Qi ID Table' },
  { id: '04a20b56131f11f186abb9fce453b8c6', name: 'CPS issues' },
  { id: '64976310089f11f186abb9fce453b8c6', name: 'CPS IC Supply Chain Infomation' },
  { id: 'ffdfd222080d11f186abb9fce453b8c6', name: 'QuickCharge' },
  { id: 'f69eb740080411f186abb9fce453b8c6', name: 'qi 2.0' },
  { id: '502d6a5a080411f186abb9fce453b8c6', name: 'qi 1.3.2' },
  { id: '971f392807cf11f186abb9fce453b8c6', name: '充电头网' },
  { id: '8ae4951c033911f1be4a0bb4759a82a5', name: 'PD3.2/UFCS' },
  { id: 'd4bfe4fc027111f1be4a0bb4759a82a5', name: 'qi 2.2.1' },
  { id: '2970c44efead11f0be4a0bb4759a82a5', name: 'cps-datasheet-whole' },
]);

function normalizeDatasetSelector(value) {
  return String(value).trim().toLowerCase();
}

function buildDatasetCatalog(itemsById) {
  const idsByNormalizedName = new Map();

  for (const [id, name] of itemsById.entries()) {
    if (typeof name === 'string' && name.trim()) {
      idsByNormalizedName.set(normalizeDatasetSelector(name), id);
    }
  }

  return {
    itemsById,
    idsByNormalizedName,
  };
}

const KNOWN_DATASET_CATALOG = buildDatasetCatalog(
  new Map(KNOWN_DATASET_ENTRIES.map((entry) => [entry.id, entry.name])),
);

let datasetCatalogCache = {
  expiresAt: 0,
  itemsById: new Map(KNOWN_DATASET_CATALOG.itemsById),
  idsByNormalizedName: new Map(KNOWN_DATASET_CATALOG.idsByNormalizedName),
};

function parseArgs(argv) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      flags.set(token, [...(flags.get(token) || []), true]);
      continue;
    }

    flags.set(token, [...(flags.get(token) || []), next]);
    index += 1;
  }

  return { positionals, flags };
}

function getFlag(flags, name, fallback = undefined) {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    return fallback;
  }

  return values[values.length - 1];
}

function getRepeatedFlags(flags, name) {
  return [...(flags.get(name) || [])].filter((value) => value !== true);
}

function coercePositiveInteger(value, fieldName) {
  if (value == null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function normalizeDatasetPageSize(value) {
  const parsed = coercePositiveInteger(value, 'pageSize');
  if (parsed == null) {
    return DATASET_PAGE_SIZE;
  }

  return Math.min(Math.max(parsed, DATASET_PAGE_SIZE_MIN), DATASET_PAGE_SIZE_MAX);
}

function normalizePageNumber(value) {
  return coercePositiveInteger(value, 'page') ?? 1;
}

function normalizeQueryPageSize(value) {
  return coercePositiveInteger(value, 'pageSize') ?? DEFAULT_QUERY_PAGE_SIZE;
}

function normalizeQueryTopK(value) {
  return coercePositiveInteger(value, 'topK') ?? DEFAULT_QUERY_TOP_K;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCrossLanguages(crossLanguages) {
  const normalized = [];
  const seen = new Set();

  for (const language of asArray(crossLanguages)) {
    if (typeof language !== 'string') {
      continue;
    }

    const trimmed = language.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function getChunkDatasetId(chunk) {
  return chunk?.dataset_id ?? chunk?.kb_id ?? null;
}

function normalizeTopDocuments(docAggs) {
  return asArray(docAggs)
    .slice(0, MAX_TOP_ITEMS)
    .map((item) => ({
      docId: item?.doc_id ?? null,
      docName: item?.doc_name ?? null,
      matchCount: typeof item?.count === 'number' ? item.count : 0,
    }));
}

function computeEvidenceSignals(chunks, docAggs) {
  const distinctDatasetIds = new Set(
    chunks.map((item) => getChunkDatasetId(item)).filter((value) => typeof value === 'string' && value),
  );
  const distinctDocumentIds = new Set(
    chunks
      .map((item) => item?.document_id ?? item?.doc_id ?? null)
      .filter((value) => typeof value === 'string' && value),
  );
  const topDocumentCount = typeof docAggs[0]?.count === 'number' ? docAggs[0].count : 0;
  const docAggTotal = docAggs.reduce(
    (sum, item) => sum + (typeof item?.count === 'number' ? item.count : 0),
    0,
  );
  const maxChunkSimilarity = chunks.reduce((max, item) => {
    const similarity = typeof item?.similarity === 'number' ? item.similarity : 0;
    return Math.max(max, similarity);
  }, 0);
  const topDocumentShare = docAggTotal > 0 ? topDocumentCount / docAggTotal : 0;

  const likelyWeakEvidence =
    chunks.length === 0 ||
    docAggs.length === 0 ||
    (
      distinctDatasetIds.size >= 3 &&
      topDocumentShare < 0.5 &&
      maxChunkSimilarity < 0.7
    ) ||
    (
      distinctDatasetIds.size >= 2 &&
      distinctDocumentIds.size >= 4 &&
      topDocumentShare < 0.4 &&
      maxChunkSimilarity < 0.6
    );

  return {
    distinctDatasetCount: distinctDatasetIds.size,
    distinctDocumentCount: distinctDocumentIds.size,
    topDocumentShare,
    maxChunkSimilarity,
    likelyWeakEvidence,
  };
}

async function getDatasetCatalog(env, options = {}) {
  if (!options.forceRefresh && Date.now() < datasetCatalogCache.expiresAt) {
    return datasetCatalogCache;
  }

  const itemsById = new Map(KNOWN_DATASET_CATALOG.itemsById);
  let page = 1;

  while (true) {
    const response = await listRagflowDatasetsFromApi(env, {
      page,
      pageSize: DATASET_CATALOG_PAGE_SIZE,
    });
    const pageItems = asArray(response?.data);

    for (const item of pageItems) {
      if (typeof item?.id === 'string' && item.id) {
        itemsById.set(item.id, typeof item.name === 'string' ? item.name : null);
      }
    }

    if (pageItems.length < DATASET_CATALOG_PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  const catalog = buildDatasetCatalog(itemsById);
  datasetCatalogCache = {
    expiresAt: Date.now() + DATASET_CACHE_TTL_MS,
    itemsById: catalog.itemsById,
    idsByNormalizedName: catalog.idsByNormalizedName,
  };
  return datasetCatalogCache;
}

function isOpaqueDatasetId(value) {
  return /^[0-9a-f]{32}$/i.test(String(value).trim());
}

async function resolveDatasetIds(env, datasetSelectors, options = {}) {
  const selectors = asArray(datasetSelectors)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);

  if (selectors.length === 0) {
    return [];
  }

  const resolvedIds = [];
  const unresolved = [];

  for (const selector of selectors) {
    if (KNOWN_DATASET_CATALOG.itemsById.has(selector)) {
      resolvedIds.push(selector);
      continue;
    }

    const resolvedFromName = KNOWN_DATASET_CATALOG.idsByNormalizedName.get(
      normalizeDatasetSelector(selector),
    );
    if (resolvedFromName) {
      resolvedIds.push(resolvedFromName);
      continue;
    }

    unresolved.push(selector);
  }

  if (unresolved.length > 0) {
    const catalog = await getDatasetCatalog(env, { forceRefresh: options.forceRefresh });

    for (const selector of unresolved) {
      if (catalog.itemsById.has(selector)) {
        resolvedIds.push(selector);
        continue;
      }

      const resolvedFromName = catalog.idsByNormalizedName.get(normalizeDatasetSelector(selector));
      if (resolvedFromName) {
        resolvedIds.push(resolvedFromName);
        continue;
      }

      if (isOpaqueDatasetId(selector)) {
        resolvedIds.push(selector);
        continue;
      }

      throw new Error(
        `Unknown dataset "${selector}". Run datasets --json to inspect the live catalog, ` +
        'pass --refresh-datasets to refresh it, or use --all-datasets to search the full library.',
      );
    }
  }

  return [...new Set(resolvedIds)];
}

async function normalizeTopChunks(env, chunks, docAggs) {
  const chunkDatasetIds = [
    ...new Set(
      chunks.map((chunk) => getChunkDatasetId(chunk)).filter((value) => typeof value === 'string' && value),
    ),
  ];
  const needsLiveCatalog = chunkDatasetIds.some((datasetId) => !KNOWN_DATASET_CATALOG.itemsById.has(datasetId));
  const datasetCatalog =
    chunks.length > 0
      ? (needsLiveCatalog ? await getDatasetCatalog(env) : KNOWN_DATASET_CATALOG).itemsById
      : new Map();
  const docNamesById = new Map(
    asArray(docAggs).map((item) => [item?.doc_id ?? null, item?.doc_name ?? null]),
  );

  return chunks.slice(0, MAX_TOP_ITEMS).map((chunk) => ({
    chunkId: chunk?.id ?? null,
    datasetId: getChunkDatasetId(chunk),
    datasetName: datasetCatalog.get(getChunkDatasetId(chunk)) ?? null,
    documentId: chunk?.document_id ?? chunk?.doc_id ?? null,
    documentName:
      docNamesById.get(chunk?.document_id ?? chunk?.doc_id ?? null) ??
      chunk?.document_name ??
      chunk?.document_keyword ??
      null,
    content: chunk?.content ?? null,
    highlight: chunk?.highlight ?? null,
    similarity: typeof chunk?.similarity === 'number' ? chunk.similarity : null,
    termSimilarity: typeof chunk?.term_similarity === 'number' ? chunk.term_similarity : null,
    vectorSimilarity:
      typeof chunk?.vector_similarity === 'number' ? chunk.vector_similarity : null,
    importantKeywords: Array.isArray(chunk?.important_keywords) ? chunk.important_keywords : [],
  }));
}

async function queryRagflow(env = process.env, options = {}) {
  if (!options.question || !String(options.question).trim()) {
    throw new Error('question is required.');
  }

  const effectivePageSize = normalizeQueryPageSize(options.pageSize);
  const effectiveTopK = normalizeQueryTopK(options.topK);
  const crossLanguages = normalizeCrossLanguages(options.crossLanguages);
  const requestBody = {
    question: String(options.question).trim(),
    page_size: effectivePageSize,
    top_k: effectiveTopK,
  };

  if (crossLanguages.length > 0) {
    requestBody.cross_languages = crossLanguages;
  }

  if (!options.allDatasets) {
    const resolvedDatasetIds = await resolveDatasetIds(env, options.datasetIds, {
      forceRefresh: Boolean(options.refreshDatasets),
    });
    if (resolvedDatasetIds.length > 0) {
      requestBody.dataset_ids = resolvedDatasetIds;
    }
  }

  if (Array.isArray(options.documentIds) && options.documentIds.length > 0) {
    requestBody.document_ids = options.documentIds;
  }

  const raw = await queryRagflowRetrieval(env, requestBody);
  const payload = raw?.data ?? {};
  const chunks = asArray(payload.chunks);
  const docAggs = asArray(payload.doc_aggs);

  return {
    total: typeof payload.total === 'number' ? payload.total : 0,
    returnedChunkCount: chunks.length,
    returnedDocAggCount: docAggs.length,
    responseHints: {
      effectivePageSize,
      effectiveTopK,
      rawAvailableOnDemand: true,
      rawIncluded: Boolean(options.includeRaw),
      preferNormalizedResults: true,
      normalizedTopDocumentLimit: MAX_TOP_ITEMS,
      normalizedTopChunkLimit: MAX_TOP_ITEMS,
    },
    evidenceSignals: computeEvidenceSignals(chunks, docAggs),
    topDocuments: normalizeTopDocuments(docAggs),
    topChunks: await normalizeTopChunks(env, chunks, docAggs),
    ...(options.includeRaw ? { raw } : {}),
  };
}

async function listDatasets(env = process.env, options = {}) {
  return listRagflowDatasetsFromApi(env, {
    page: normalizePageNumber(options.page),
    pageSize: normalizeDatasetPageSize(options.pageSize),
    name: options.name,
  });
}

async function status(env = process.env) {
  return getCpsAuthStatus(env);
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function usage() {
  return [
    'Usage:',
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-ragflow.js status [--json]`,
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-ragflow.js datasets [--page N] [--page-size N] [--name KEYWORD] [--json]`,
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-ragflow.js query --question "..." [--dataset-id ID_OR_NAME ...] [--document-id ID ...] [--cross-language LANG ...] [--page-size N] [--top-k N] [--all-datasets] [--refresh-datasets] [--include-raw] [--json]`,
    '',
    'Fallback when Bun is unavailable:',
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-ragflow.js status [--json]`,
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-ragflow.js datasets [--page N] [--page-size N] [--name KEYWORD] [--json]`,
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-ragflow.js query --question "..." [--dataset-id ID_OR_NAME ...] [--document-id ID ...] [--cross-language LANG ...] [--page-size N] [--top-k N] [--all-datasets] [--refresh-datasets] [--include-raw] [--json]`,
  ].join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const asJson = Boolean(getFlag(flags, '--json', false));

  if (!command) {
    throw new Error(usage());
  }

  switch (command) {
    case 'status': {
      printResult(await status(env), asJson);
      return;
    }
    case 'datasets': {
      printResult(
        await listDatasets(env, {
          page: getFlag(flags, '--page'),
          pageSize: getFlag(flags, '--page-size'),
          name: getFlag(flags, '--name'),
        }),
        asJson,
      );
      return;
    }
    case 'query': {
      printResult(
        await queryRagflow(env, {
          question: getFlag(flags, '--question'),
          datasetIds: getRepeatedFlags(flags, '--dataset-id'),
          documentIds: getRepeatedFlags(flags, '--document-id'),
          crossLanguages: getRepeatedFlags(flags, '--cross-language'),
          pageSize: getFlag(flags, '--page-size'),
          topK: getFlag(flags, '--top-k'),
          allDatasets: Boolean(getFlag(flags, '--all-datasets', false)),
          refreshDatasets: Boolean(getFlag(flags, '--refresh-datasets', false)),
          includeRaw: Boolean(getFlag(flags, '--include-raw', false)),
        }),
        asJson,
      );
      return;
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${usage()}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DATASET_CACHE_TTL_MS,
  DATASET_PAGE_SIZE,
  DEFAULT_QUERY_PAGE_SIZE,
  DEFAULT_QUERY_TOP_K,
  KNOWN_DATASET_ENTRIES,
  listDatasets,
  queryRagflow,
  resolveDatasetIds,
  status,
};
