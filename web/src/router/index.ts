import { createRouter, createWebHashHistory } from "vue-router";
import TaskDashboard from "../pages/TaskDashboard.vue";
import ResultAnalysis from "../pages/ResultAnalysis.vue";
import CrossDeviceAnalysis from "../pages/CrossDeviceAnalysis.vue";
import ConsistencyAnalysis from "../pages/ConsistencyAnalysis.vue";
import LoginPage from "../pages/LoginPage.vue";
import { isAuthSessionValid } from "../authSession.js";

export const router = createRouter({
  history: createWebHashHistory("/dashboard/"),
  routes: [
    { path: "/", redirect: "/tasks" },
    { path: "/login", component: LoginPage, meta: { public: true } },
    { path: "/tasks", component: TaskDashboard },
    { path: "/analysis", component: ResultAnalysis },
    { path: "/cross-device", component: CrossDeviceAnalysis },
    { path: "/consistency", component: ConsistencyAnalysis },
    { path: "/consistency/:taskId", component: ConsistencyAnalysis },
  ],
});

router.beforeEach((to) => {
  const isPublicRoute = to.meta.public === true;
  const isLoggedIn = isAuthSessionValid(window.localStorage);

  if (to.path === "/login" && isLoggedIn) {
    return "/tasks";
  }

  if (!isPublicRoute && !isLoggedIn) {
    return {
      path: "/login",
      query: to.fullPath === "/" ? undefined : { redirect: to.fullPath },
    };
  }

  return true;
});
