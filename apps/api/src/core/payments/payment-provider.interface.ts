// CLAUDE: Stable contract every PaymentProvider implementation must satisfy.
// All monetary fields are integer toman (BIGINT) — providers are responsible
// for converting to/from Rial internally if their gateway requires it.
export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

export interface PaymentProvider {
  name: string;
  initiate(input: InitiateInput): Promise<InitiateOutput>;
  verify(input: VerifyInput): Promise<VerifyOutput>;
  refund(input: RefundInput): Promise<RefundOutput>;
}

export interface InitiateInput {
  amount: bigint;
  description: string;
  callbackUrl: string;
  referenceId: string;
  userMobile?: string;
  userEmail?: string;
}

export interface InitiateOutput {
  redirectUrl: string;
  providerReference: string;
}

export interface VerifyInput {
  providerReference: string;
  expectedAmount: bigint;
}

export interface VerifyOutput {
  verified: boolean;
  referenceCode?: string;
  cardPan?: string;
  failureReason?: string;
}

export interface RefundInput {
  providerReference: string;
  amount: bigint;
  reason: string;
}

export interface RefundOutput {
  refunded: boolean;
  failureReason?: string;
}
