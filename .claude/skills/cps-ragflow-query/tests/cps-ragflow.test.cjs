const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { listDatasets, queryRagflow } = require('../scripts/cps-ragflow.js');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('listDatasets defaults to a small page size and forwards bearer auth to the MyAgents management API', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      data: [
        { id: 'dataset-1', name: 'qi 2.2.1' },
      ],
    }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const response = await listDatasets(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        name: 'qi',
      },
    );

    assert.equal(response.data.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].authorization, 'Bearer secret-token');
    assert.match(requests[0].url, /page=1/);
    assert.match(requests[0].url, /page_size=7/);
    assert.match(requests[0].url, /name=qi/);
  } finally {
    await close(server);
  }
});

test('queryRagflow normalizes retrieval output and backfills dataset names', async () => {
  const requests = [];
  let retrievalBody = null;
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
    });

    if (req.url.startsWith('/api/cps/ragflow/datasets')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: [
          { id: 'dataset-qi-221', name: 'qi 2.2.1' },
          { id: 'dataset-pd', name: 'PD3.2/UFCS' },
        ],
      }));
      return;
    }

    if (req.url === '/api/cps/ragflow/retrieval') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        retrievalBody = JSON.parse(body);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          data: {
            total: 90,
            doc_aggs: [
              { doc_id: 'doc-1', doc_name: 'Qi 2.2.1 Overview', count: 2 },
              { doc_id: 'doc-2', doc_name: 'Qi 2.2.1 Product Table', count: 1 },
            ],
            chunks: [
              {
                id: 'chunk-1',
                dataset_id: 'd4bfe4fc027111f1be4a0bb4759a82a5',
                document_id: 'doc-1',
                document_keyword: 'Qi 2.2.1 Overview',
                content: 'Qi 2.2.1 introduces new power profile handling.',
                highlight: 'new power profile handling',
                similarity: 0.95,
                term_similarity: 0.82,
                vector_similarity: 0.91,
                important_keywords: ['qi', '2.2.1'],
              },
              {
                id: 'chunk-2',
                dataset_id: 'd4bfe4fc027111f1be4a0bb4759a82a5',
                document_id: 'doc-2',
                document_keyword: 'Qi 2.2.1 Product Table',
                content: 'Certified transmitters must meet updated thresholds.',
                highlight: 'updated thresholds',
                similarity: 0.91,
                term_similarity: 0.79,
                vector_similarity: 0.88,
                important_keywords: ['thresholds'],
              },
              {
                id: 'chunk-3',
                kb_id: '8ae4951c033911f1be4a0bb4759a82a5',
                document_id: 'doc-3',
                document_keyword: 'UFCS Interop',
                content: 'Cross-protocol references can still appear in retrieval.',
                highlight: 'Cross-protocol references',
                similarity: 0.75,
                term_similarity: 0.55,
                vector_similarity: 0.7,
                important_keywords: ['interop'],
              },
            ],
          },
        }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'What is Qi 2.2.1?',
        datasetIds: ['qi 2.2.1'],
      },
    );

    assert.equal(result.total, 90);
    assert.equal(result.returnedChunkCount, 3);
    assert.equal(result.returnedDocAggCount, 2);
    assert.equal(result.evidenceSignals.likelyWeakEvidence, false);
    assert.equal(result.responseHints.effectiveTopK, 100);
    assert.equal(result.responseHints.effectivePageSize, 8);
    assert.equal(result.responseHints.rawIncluded, false);
    assert.equal(result.responseHints.preferNormalizedResults, true);
    assert.equal(result.evidenceSignals.distinctDatasetCount, 2);
    assert.deepEqual(retrievalBody, {
      question: 'What is Qi 2.2.1?',
      dataset_ids: ['d4bfe4fc027111f1be4a0bb4759a82a5'],
      page_size: 8,
      top_k: 100,
    });
    assert.equal(result.topDocuments[0].docId, 'doc-1');
    assert.equal(result.topDocuments[0].docName, 'Qi 2.2.1 Overview');
    assert.equal(result.topDocuments[0].matchCount, 2);
    assert.equal(result.topChunks[0].datasetName, 'qi 2.2.1');
    assert.equal(result.topChunks[0].documentName, 'Qi 2.2.1 Overview');
    assert.equal(result.topChunks[2].datasetName, 'PD3.2/UFCS');
    assert.equal('raw' in result, false);
    assert.equal(requests[0].authorization, 'Bearer secret-token');
  } finally {
    await close(server);
  }
});

test('queryRagflow omits raw by default when retrieval returns no hits', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/cps/ragflow/retrieval') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 0,
        data: {
          total: 0,
          doc_aggs: [],
          chunks: [],
        },
      }));
      return;
    }

    if (req.url.startsWith('/api/cps/ragflow/datasets')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: [] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'unknown protocol',
      },
    );

    assert.equal(result.total, 0);
    assert.equal(result.returnedChunkCount, 0);
    assert.equal(result.returnedDocAggCount, 0);
    assert.equal(result.evidenceSignals.likelyWeakEvidence, true);
    assert.equal(result.responseHints.effectiveTopK, 100);
    assert.equal(result.responseHints.effectivePageSize, 8);
    assert.equal(result.responseHints.rawIncluded, false);
    assert.deepEqual(result.topDocuments, []);
    assert.deepEqual(result.topChunks, []);
    assert.equal('raw' in result, false);
  } finally {
    await close(server);
  }
});

test('queryRagflow marks scattered low-concentration hits as likely weak evidence', async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/cps/ragflow/datasets')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: [
          { id: 'dataset-a', name: 'WPT Patents' },
          { id: 'dataset-b', name: 'Datasheet' },
          { id: 'dataset-c', name: 'CPS issues' },
        ],
      }));
      return;
    }

    if (req.url === '/api/cps/ragflow/retrieval') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 0,
        data: {
          total: 90,
          doc_aggs: [
            { doc_id: 'doc-a', doc_name: 'Patent Index', count: 4 },
            { doc_id: 'doc-b', doc_name: 'Datasheet Overview', count: 3 },
            { doc_id: 'doc-c', doc_name: 'Issue Log', count: 2 },
          ],
          chunks: [
            {
              id: 'chunk-a',
              dataset_id: 'dataset-a',
              document_id: 'doc-a',
              document_keyword: 'Patent Index',
              content: 'Protocol references appear in unrelated patent text.',
              highlight: 'protocol references',
              similarity: 0.58,
              term_similarity: 0.69,
              vector_similarity: 0.28,
              important_keywords: [],
            },
            {
              id: 'chunk-b',
              dataset_id: 'dataset-b',
              document_id: 'doc-b',
              document_keyword: 'Datasheet Overview',
              content: 'Datasheet notes with no direct support for the question.',
              highlight: 'datasheet notes',
              similarity: 0.52,
              term_similarity: 0.61,
              vector_similarity: 0.22,
              important_keywords: [],
            },
            {
              id: 'chunk-c',
              dataset_id: 'dataset-c',
              document_id: 'doc-c',
              document_keyword: 'Issue Log',
              content: 'Issue log also matched loosely.',
              highlight: 'matched loosely',
              similarity: 0.47,
              term_similarity: 0.55,
              vector_similarity: 0.19,
              important_keywords: [],
            },
          ],
        },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'nonexistent cps protocol 12345',
      },
    );

    assert.equal(result.evidenceSignals.distinctDatasetCount, 3);
    assert.equal(result.evidenceSignals.distinctDocumentCount, 3);
    assert.equal(result.evidenceSignals.likelyWeakEvidence, true);
    assert.equal(result.responseHints.effectiveTopK, 100);
    assert.equal(result.responseHints.effectivePageSize, 8);
    assert.ok(result.evidenceSignals.topDocumentShare < 0.5);
  } finally {
    await close(server);
  }
});

test('queryRagflow can include raw output explicitly for debugging', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/cps/ragflow/retrieval') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        code: 0,
        data: {
          total: 1,
          doc_aggs: [],
          chunks: [],
        },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'debug retrieval payload',
        includeRaw: true,
      },
    );

    assert.equal(result.responseHints.rawIncluded, true);
    assert.equal(result.raw.data.total, 1);
  } finally {
    await close(server);
  }
});

test('queryRagflow forwards explicit cross languages without duplicates', async () => {
  let retrievalBody = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/cps/ragflow/retrieval') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        retrievalBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          data: {
            total: 0,
            doc_aggs: [],
            chunks: [],
          },
        }));
      });
      return;
    }

    if (req.url.startsWith('/api/cps/ragflow/datasets')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: [] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'Japanese query',
        crossLanguages: ['ja', 'en', 'ja'],
      },
    );

    assert.deepEqual(retrievalBody.cross_languages, ['ja', 'en']);
  } finally {
    await close(server);
  }
});

test('queryRagflow refreshes the live dataset catalog to resolve new dataset names', async () => {
  const requests = [];
  let retrievalBody = null;
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
    });

    if (req.url.startsWith('/api/cps/ragflow/datasets')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        data: [
          { id: 'dataset-new', name: 'Brand New Dataset' },
        ],
      }));
      return;
    }

    if (req.url === '/api/cps/ragflow/retrieval') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        retrievalBody = JSON.parse(body);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          code: 0,
          data: {
            total: 1,
            doc_aggs: [],
            chunks: [
              {
                id: 'chunk-new',
                dataset_id: 'dataset-new',
                document_id: 'doc-new',
                document_keyword: 'Brand New Dataset Intro',
                content: 'Fresh content',
                highlight: 'Fresh content',
                similarity: 0.91,
                term_similarity: 0.88,
                vector_similarity: 0.9,
                important_keywords: ['fresh'],
              },
            ],
          },
        }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await queryRagflow(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        question: 'What is in the new dataset?',
        datasetIds: ['Brand New Dataset'],
        refreshDatasets: true,
      },
    );

    assert.deepEqual(retrievalBody, {
      question: 'What is in the new dataset?',
      dataset_ids: ['dataset-new'],
      page_size: 8,
      top_k: 100,
    });
    assert.equal(result.topChunks[0].datasetName, 'Brand New Dataset');
    assert.match(requests[0].url, /page=1/);
    assert.match(requests[0].url, /page_size=30/);
    assert.equal(requests[1].url, '/api/cps/ragflow/retrieval');
  } finally {
    await close(server);
  }
});
