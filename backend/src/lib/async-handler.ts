import type { NextFunction, RequestHandler, Request, Response } from "express";

type AsyncHandler = <TBody = unknown, TParams = unknown>(
  fn: (
    req: Request<TParams, unknown, TBody>,
    res: Response,
    next: NextFunction,
  ) => Promise<unknown> | unknown,
) => RequestHandler<TParams, unknown, TBody>;

export const asyncHandler: AsyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
