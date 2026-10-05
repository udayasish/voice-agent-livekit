import type { ApiError, ApiSuccess } from "../types.js";

export const successResponse = <T>(data: T): ApiSuccess<T> => ({
  success: true,
  data,
});

export const errorResponse = (code: string, message: string): ApiError => ({
  success: false,
  error: {
    code,
    message,
  },
});

export const success = successResponse;
export const failure = errorResponse;
