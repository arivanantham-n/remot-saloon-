/**
 * supabase-browser.js — Frontend (Vanilla JS) Supabase client helper
 *
 * This file is served as a static asset by the Express server.
 * Include it in your HTML pages AFTER the Supabase CDN script (or use it
 * standalone with the bundled supabase-js UMD build already in node_modules).
 *
 * Usage in HTML:
 *   <!-- Option A: Use CDN (recommended for vanilla HTML pages) -->
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
 *   <script src="/js/supabase-browser.js"></script>
 *
 *   Then in any inline script or other JS file:
 *     const { data } = await window.SupabaseClient.from('table').select('*');
 */

(function (global) {
  'use strict';

  // These values are safe to expose in the browser (publishable key only).
  // Never put a Service Role key here.
  const SUPABASE_URL = 'https://ejffdomyufclavknrddr.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NG5RduzW9b4Uzb3MW3ijig_x4BCLGtx';

  // Wait until the Supabase library is available (loaded from CDN or bundled)
  function initSupabase() {
    if (typeof global.supabase === 'undefined') {
      console.warn('[Supabase Browser] supabase-js library not yet loaded. ' +
        'Make sure the CDN <script> tag is placed BEFORE this file.');
      return null;
    }
    return global.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  }

  // Expose a singleton on the global scope for use in any page script
  global.SupabaseClient = initSupabase();

})(window);
