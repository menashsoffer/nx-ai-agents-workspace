export interface LibGeneratorSchema {
  name: string;
  type?: 'util' | 'ui' | 'feature';
  scope?: 'shared' | 'product' | 'dev';
}
