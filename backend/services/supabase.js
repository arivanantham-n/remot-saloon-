/**
 * supabase.js — Backend (Express) Supabase client helper
 *
 * Uses @supabase/supabase-js directly (not @supabase/ssr, which is Next.js only).
 * Import this wherever you need server-side Supabase access in route handlers.
 *
 * Usage:
 *   const { supabase } = require('../services/supabase');
 *   const { data, error } = await supabase.from('table').select('*');
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[Supabase] WARNING: SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set. ' +
    'Supabase features will be disabled until these environment variables are configured.'
  );
}

/**
 * Singleton Supabase client for server-side (Express) usage.
 * Uses the publishable key — safe for read operations.
 * For admin operations requiring elevated privileges, set SUPABASE_SERVICE_ROLE_KEY
 * and create a separate adminSupabase client using that key.
 */
const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        // Disable auto-refresh in server context (no browser session)
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  : null;

module.exports = { supabase };
