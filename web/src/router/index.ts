import { createRouter, createWebHashHistory } from "vue-router";
import TaskDashboard from "../pages/TaskDashboard.vue";
import CaseReports from "../pages/CaseReports.vue";
import ResultAnalysis from "../pages/ResultAnalysis.vue";
import CrossDeviceAnalysis from "../pages/CrossDeviceAnalysis.vue";
import ConsistencyAnalysis from "../pages/ConsistencyAnalysis.vue";

export const router = createRouter({
  history: createWebHashHistory("/dashboard/"),
  routes: [
    { path: "/", redirect: "/tasks" },
    { path: "/tasks", component: TaskDashboard },
    { path: "/reports", component: CaseReports },
    { path: "/analysis", component: ResultAnalysis },
    { path: "/cross-device", component: CrossDeviceAnalysis },
    { path: "/consistency", component: ConsistencyAnalysis },
    { path: "/consistency/:taskId", component: ConsistencyAnalysis },
  ],
});
