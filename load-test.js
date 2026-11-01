/**
 * Glö Salon Platform — High-Concurrency Stress & Load Testing Suite
 * Simulates up to 1,000+ concurrent virtual users hitting the API and frontend.
 * Measures throughput (RPS), p50, p95, p99 latency, error rates, and cache hits.
 *
 * Usage:
 *   node load-test.js [targetUrl] [totalRequests] [concurrency]
 * Example:
 *   node load-test.js http://localhost:5000 2000 200
 */

const http = require('http');
const https = require('https');
const url = require('url');

const TARGET_URL = process.argv[2] || 'http://localhost:5000';
const TOTAL_REQUESTS = parseInt(process.argv[3], 10) || 1000;
const CONCURRENCY = parseInt(process.argv[4], 10) || 100;

const ENDPOINTS = [
  '/',
  '/api/health',
  '/api/services',
  '/api/services?category=Women',
  '/api/services?category=Men',
  '/api/salons',
  '/catalog.html',
  '/booking.html'
];

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 Glö Salon — High Concurrency Load Test Runner');
console.log(`🎯 Target URL:       ${TARGET_URL}`);
console.log(`📊 Total Requests:   ${TOTAL_REQUESTS}`);
console.log(`⚡ Concurrency:      ${CONCURRENCY} simultaneous virtual users`);
console.log('═══════════════════════════════════════════════════════════════\n');

const stats = {
  total: 0,
  successful: 0,
  failed: 0,
  cacheHits: 0,
  cacheMisses: 0,
  latencies: [],
  statusCodes: {}
};

const parsedBase = url.parse(TARGET_URL);
const isHttps = parsedBase.protocol === 'https:';
const client = isHttps ? https : http;

const agent = new client.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY * 2
});

let requestIndex = 0;
const startTime = Date.now();

function sendRequest() {
  if (requestIndex >= TOTAL_REQUESTS) return;

  const currentIdx = ++requestIndex;
  const endpoint = ENDPOINTS[currentIdx % ENDPOINTS.length];
  const target = new URL(endpoint, TARGET_URL);

  const reqStart = Date.now();

  const req = client.get(target.href, { agent }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      const duration = Date.now() - reqStart;
      stats.latencies.push(duration);
      stats.total++;

      stats.statusCodes[res.statusCode] = (stats.statusCodes[res.statusCode] || 0) + 1;

      if (res.statusCode >= 200 && res.statusCode < 400) {
        stats.successful++;
      } else {
        stats.failed++;
      }

      const cacheHeader = res.headers['x-cache'];
      if (cacheHeader === 'HIT') stats.cacheHits++;
      if (cacheHeader === 'MISS') stats.cacheMisses++;

      // Next in pool
      if (requestIndex < TOTAL_REQUESTS) {
        sendRequest();
      } else if (stats.total === TOTAL_REQUESTS) {
        printReport();
      }
    });
  });

  req.on('error', (err) => {
    const duration = Date.now() - reqStart;
    stats.latencies.push(duration);
    stats.total++;
    stats.failed++;
    stats.statusCodes['ERR'] = (stats.statusCodes['ERR'] || 0) + 1;

    if (requestIndex < TOTAL_REQUESTS) {
      sendRequest();
    } else if (stats.total === TOTAL_REQUESTS) {
      printReport();
    }
  });

  req.setTimeout(10000, () => {
    req.abort();
  });
}

// Spin up concurrent worker threads
for (let i = 0; i < Math.min(CONCURRENCY, TOTAL_REQUESTS); i++) {
  sendRequest();
}

function printReport() {
  const totalTimeMs = Date.now() - startTime;
  const totalSecs = totalTimeMs / 1000;
  const rps = (stats.total / totalSecs).toFixed(2);

  stats.latencies.sort((a, b) => a - b);
  const sum = stats.latencies.reduce((acc, l) => acc + l, 0);
  const avg = (sum / (stats.latencies.length || 1)).toFixed(2);
  const min = stats.latencies[0] || 0;
  const max = stats.latencies[stats.latencies.length - 1] || 0;

  const p50 = stats.latencies[Math.floor(stats.latencies.length * 0.50)] || 0;
  const p90 = stats.latencies[Math.floor(stats.latencies.length * 0.90)] || 0;
  const p95 = stats.latencies[Math.floor(stats.latencies.length * 0.95)] || 0;
  const p99 = stats.latencies[Math.floor(stats.latencies.length * 0.99)] || 0;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 LOAD TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`⏱️  Total Duration:     ${totalSecs.toFixed(2)}s`);
  console.log(`🚀 Throughput:         ${rps} req/sec`);
  console.log(`✅ Success Rate:       ${((stats.successful / stats.total) * 100).toFixed(2)}% (${stats.successful}/${stats.total})`);
  console.log(`❌ Error Count:        ${stats.failed}`);
  console.log(`⚡ Cache Hits/Misses:  ${stats.cacheHits} Hits / ${stats.cacheMisses} Misses`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('📈 LATENCY DISTRIBUTION (ms):');
  console.log(`   Min:       ${min} ms`);
  console.log(`   Average:   ${avg} ms`);
  console.log(`   p50 (Med): ${p50} ms`);
  console.log(`   p90:       ${p90} ms`);
  console.log(`   p95:       ${p95} ms`);
  console.log(`   p99:       ${p99} ms`);
  console.log(`   Max:       ${max} ms`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log('🏷️  STATUS CODES:');
  for (const [code, count] of Object.entries(stats.statusCodes)) {
    console.log(`   HTTP ${code}: ${count}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (stats.failed === 0 && p95 < 200) {
    console.log('🎉 PERFORMANCE GRADE: A+ (Production-Grade High Concurrency Ready)');
  } else if (stats.failed === 0) {
    console.log('👍 PERFORMANCE GRADE: A (Passing)');
  } else {
    console.log('⚠️  PERFORMANCE GRADE: B (Errors detected, check server logs)');
  }
  process.exit(0);
}
