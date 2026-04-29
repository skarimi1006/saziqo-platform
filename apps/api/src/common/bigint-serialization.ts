// SECURITY: Prisma uses BigInt for primary keys but JSON.stringify cannot
// serialize BigInt natively. Convert to string in HTTP responses; consumers
// should treat IDs as opaque strings, not numbers (precision loss > 2^53).
// This module is a side-effect import — bring it in once at app startup
// (main.ts and test bootstrap).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint): string {
  return this.toString();
};
