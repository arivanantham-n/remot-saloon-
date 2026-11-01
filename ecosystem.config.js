/**
 * Glö Salon Platform — PM2 Cluster Mode Ecosystem Configuration
 * Runs the Node.js application across all CPU cores with automatic zero-downtime reload.
 */

module.exports = {
  apps: [
    {
      name: 'glo-salon-api',
      script: './backend/server.js',
      instances: 'max',            // Scale to all available CPU cores
      exec_mode: 'cluster',        // Enable NodeJS cluster mode
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',    // Restart worker if it exceeds 1GB RAM
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      // Zero-downtime rolling restart settings
      kill_timeout: 5000,
      listen_timeout: 8000,
      wait_ready: true,
      max_restarts: 10,
      restart_delay: 1000
    }
  ]
};
