import winston from "winston";

const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.splat(),
  winston.format.printf(
    ({ timestamp, level, message, ...meta }) =>
      `[${timestamp}] [${level}]: ${message} ${
        Object.keys(meta).length ? "\n" + JSON.stringify(meta, null, 2) : ""
      }`,
  ),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
);

const logger = winston.createLogger({
  level: process.env["NODE_ENV"] === "production" ? "info" : "verbose",
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    process.env["NODE_ENV"] === "production" ? prodFormat : devFormat,
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
