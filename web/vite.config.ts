import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const dashboardApiProxy = {
  target: "http://localhost:3000",
  changeOrigin: true,
};

export default defineConfig({
  base: "/dashboard/",
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/dashboard/summary": dashboardApiProxy,
      "/dashboard/tasks": dashboardApiProxy,
      "/dashboard/reports": dashboardApiProxy,
      "/dashboard/analysis": dashboardApiProxy,
      "/dashboard/cross-device": dashboardApiProxy,
      "/score/run-remote-task": dashboardApiProxy,
      "/score/remote-tasks": dashboardApiProxy,
      "/score/consistency-tasks": dashboardApiProxy,
    },
  },
});
