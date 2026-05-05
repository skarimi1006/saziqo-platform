export interface CartLineDescriptor {
  moduleSource: string;
  moduleItemId: string;
  titleFa: string;
  priceToman: bigint;
  metadata: Record<string, unknown>;
}

export interface CartAdapter {
  readonly moduleSource: string;
  getForUser(userId: bigint): Promise<CartLineDescriptor[]>;
  removeItem(userId: bigint, moduleItemId: string): Promise<void>;
  clearForUser(userId: bigint): Promise<void>;
}
