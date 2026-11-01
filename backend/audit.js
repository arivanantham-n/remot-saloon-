const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('==============================================');
console.log('       GLÖ SALON FULL AUDIT REPORT            ');
console.log('==============================================\n');

const frontendDir = path.resolve(__dirname, '../frontend');
const backendDir = __dirname;
const htmlFiles = fs.readdirSync(frontendDir).filter(f => f.endsWith('.html'));

let errorsFound = [];
let warningsFound = [];

// 1. Static HTML & Asset Audit
console.log('--- 1. AUDITING FRONTEND ASSETS & HTML ---');
for (const file of htmlFiles) {
  const filePath = path.join(frontendDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // Check script tags
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;
  while ((match = scriptRegex.exec(content)) !== null) {
    scriptIndex++;
    const attrs = match[1];
    const inlineCode = match[2];

    const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      const src = srcMatch[1];
      if (!src.startsWith('http://') && !src.startsWith('https://')) {
        const cleanPath = src.split('?')[0].split('#')[0];
        const absPath = path.resolve(frontendDir, cleanPath);
        if (!fs.existsSync(absPath)) {
          errorsFound.push({
            type: 'Broken Asset Link (Script)',
            file: file,
            details: `Missing script file: ${src} (resolved to ${absPath})`
          });
        }
      }
    } else if (inlineCode.trim()) {
      // Check syntax of inline script
      const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
      const isBabelOrModule = typeMatch && (typeMatch[1].includes('babel') || typeMatch[1].includes('module'));
      if (!isBabelOrModule) {
        try {
          new Function(inlineCode);
        } catch (e) {
          errorsFound.push({
            type: 'Inline JS Syntax Error',
            file: file,
            details: `Script block #${scriptIndex}: ${e.message}`
          });
        }
      }
    }
  }

  // Check stylesheet links
  const linkRegex = /<link\b([^>]*)>/gi;
  while ((match = linkRegex.exec(content)) !== null) {
    const attrs = match[1];
    if (/rel=["']stylesheet["']/i.test(attrs)) {
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const href = hrefMatch[1];
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          const cleanPath = href.split('?')[0].split('#')[0];
          const absPath = path.resolve(frontendDir, cleanPath);
          if (!fs.existsSync(absPath)) {
            errorsFound.push({
              type: 'Broken Asset Link (CSS)',
              file: file,
              details: `Missing CSS file: ${href} (resolved to ${absPath})`
            });
          }
        }
      }
    }
  }

  // Check internal anchor links (e.g. href="xyz.html")
  const hrefRegex = /href=["']([^"']+)["']/gi;
  while ((match = hrefRegex.exec(content)) !== null) {
    const href = match[1];
    if (href.endsWith('.html') && !href.startsWith('http://') && !href.startsWith('https://')) {
      const cleanPath = href.split('?')[0].split('#')[0];
      const absPath = path.resolve(frontendDir, cleanPath);
      if (!fs.existsSync(absPath)) {
        errorsFound.push({
          type: 'Broken Page Link',
          file: file,
          details: `Link to non-existent page: ${href}`
        });
      }
    }
  }

  // Check local images
  const imgRegex = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(content)) !== null) {
    const src = match[1];
    if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
      const cleanPath = src.split('?')[0].split('#')[0];
      const absPath = path.resolve(frontendDir, cleanPath);
      if (!fs.existsSync(absPath)) {
        warningsFound.push({
          type: 'Missing Local Image',
          file: file,
          details: `Image not found: ${src}`
        });
      }
    }
  }
}

// Check CSS files for broken url(...) references
const cssDir = path.resolve(frontendDir, 'css');
const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
for (const cFile of cssFiles) {
  const cContent = fs.readFileSync(path.join(cssDir, cFile), 'utf8');
  const urlMatches = cContent.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi);
  for (const m of urlMatches) {
    const u = m[1];
    if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('data:')) continue;
    const cleanU = u.split('?')[0].split('#')[0];
    const absPath = path.resolve(cssDir, cleanU);
    if (!fs.existsSync(absPath)) {
      warningsFound.push({
        type: 'Broken CSS URL',
        file: `css/${cFile}`,
        details: `Asset not found: ${u} (resolved to ${absPath})`
      });
    }
  }
}

// 2. Test HTTP response of each HTML page and major static assets
async function testHttpPages() {
  console.log('\n--- 2. AUDITING HTTP RESPONSES FROM SERVER (PORT 5000) ---');
  function checkUrl(urlPath) {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 5000,
        path: urlPath,
        method: 'GET'
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', err => resolve({ status: 0, error: err.message }));
      req.end();
    });
  }

  for (const file of htmlFiles) {
    const res = await checkUrl('/' + file);
    if (res.status !== 200) {
      errorsFound.push({
        type: 'HTTP Serving Error',
        file: file,
        details: `Request to /${file} returned status ${res.status}`
      });
    }
  }

  // Check / (root)
  const rootRes = await checkUrl('/');
  if (rootRes.status !== 200) {
    errorsFound.push({
      type: 'HTTP Serving Error',
      file: '/',
      details: `Request to / returned status ${rootRes.status}`
    });
  }

  // Check /js/api.js
  const apiJsRes = await checkUrl('/js/api.js');
  if (apiJsRes.status !== 200) {
    errorsFound.push({
      type: 'HTTP Serving Error',
      file: '/js/api.js',
      details: `Request to /js/api.js returned status ${apiJsRes.status}`
    });
  }

  // 3. API Endpoints Audit
  console.log('\n--- 3. AUDITING BACKEND API ENDPOINTS ---');
  const apiEndpoints = [
    { path: '/api/health', method: 'GET', expect: 200 },
    { path: '/api/services', method: 'GET', expect: 200 },
    { path: '/api/salons', method: 'GET', expect: 200 },
    { path: '/api/reviews/salon/invalid-id', method: 'GET', expect: [200, 400, 404] },
    { path: '/api/payments/config', method: 'GET', expect: 200 },
    { path: '/api/auth/me', method: 'GET', expect: [401, 200] },
    { path: '/api/profile/client', method: 'GET', expect: [401, 403] },
    { path: '/api/profile/owner', method: 'GET', expect: [401, 403] },
    { path: '/api/bookings/my', method: 'GET', expect: [401, 403] },
    { path: '/api/admin/stats', method: 'GET', expect: [401, 403] }
  ];

  for (const ep of apiEndpoints) {
    const res = await checkUrl(ep.path);
    const expected = Array.isArray(ep.expect) ? ep.expect : [ep.expect];
    if (!expected.includes(res.status)) {
      errorsFound.push({
        type: 'Unexpected API Status',
        file: ep.path,
        details: `Expected ${expected.join('/')}, but received HTTP ${res.status}: ${res.body ? res.body.slice(0, 100) : res.error || 'No response body'}`
      });
    } else {
      console.log(`  ✓ ${ep.path} -> ${res.status}`);
    }
  }

  console.log('\n==============================================');
  console.log(`SUMMARY: ${errorsFound.length} ERRORS, ${warningsFound.length} WARNINGS FOUND`);
  console.log('==============================================');

  if (errorsFound.length > 0) {
    console.log('\n❌ ERRORS:');
    errorsFound.forEach((e, i) => console.log(`  ${i+1}. [${e.type}] ${e.file}: ${e.details}`));
  } else {
    console.log('\n✅ No critical static or serving errors found.');
  }

  if (warningsFound.length > 0) {
    console.log('\n⚠️ WARNINGS:');
    warningsFound.forEach((w, i) => console.log(`  ${i+1}. [${w.type}] ${w.file}: ${w.details}`));
  }
}

testHttpPages();
