import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { initializeAnalytics } from "./lib/analytics";
import "./styles.css";

createApp(App).use(createPinia()).mount("#app");
initializeAnalytics();
