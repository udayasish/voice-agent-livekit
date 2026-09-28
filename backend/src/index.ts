import { config } from "dotenv";
config();
import { App } from "./app.js";
import env from "./lib/env.js";
import logger from "./lib/logger.js";

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
});

const PORT = env.PORT;
const app = new App();

app.listen(PORT, () => {
  logger.info(`Health check available at http://localhost:${PORT}/api/v1/health`);
});
