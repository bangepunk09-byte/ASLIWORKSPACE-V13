module.exports = {
  apps: [
    {
      name: "asli-workspace",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        NODE_OPTIONS: "--max-old-space-size=1024",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      kill_timeout: 5000,
      listen_timeout: 10000,
      restart_delay: 2000,
      merge_logs: true,
    },
  ],
};
