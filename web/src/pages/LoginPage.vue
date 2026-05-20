<template>
  <main class="login-page">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="login-brand">HMOS Score</div>
      <h1 id="login-title">登录</h1>
      <el-form class="login-form" :model="form" @submit.prevent="submitLogin">
        <el-form-item label="用户名">
          <el-input v-model.trim="form.username" autocomplete="username" autofocus />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="form.password"
            autocomplete="current-password"
            show-password
            type="password"
            @keyup.enter="submitLogin"
          />
        </el-form-item>
        <el-alert v-if="errorMessage" :closable="false" :title="errorMessage" type="error" />
        <el-button class="login-submit" native-type="submit" type="primary">登录</el-button>
      </el-form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { createAuthSession, verifyCredentials } from "../authSession.js";

const router = useRouter();
const route = useRoute();
const form = reactive({
  username: "admin",
  password: "",
});
const errorMessage = ref("");

async function submitLogin() {
  errorMessage.value = "";
  if (!verifyCredentials(form.username, form.password)) {
    errorMessage.value = "用户名或密码错误";
    return;
  }

  createAuthSession(window.localStorage);
  const redirectPath = typeof route.query.redirect === "string" ? route.query.redirect : "/tasks";
  await router.replace(redirectPath);
}
</script>
