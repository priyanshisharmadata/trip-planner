import { createPlannerHandler } from './handler.ts';

// Keep runtime-only globals out of the shared mobile/browser contract.
const runtime = (globalThis as unknown as {
  Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
}).Deno;

runtime.serve(createPlannerHandler({ env: (name) => runtime.env.get(name) }));
