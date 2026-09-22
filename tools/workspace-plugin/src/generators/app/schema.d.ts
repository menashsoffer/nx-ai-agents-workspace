export interface AppGeneratorSchema {
  name: string;
  scope?: 'dev' | 'product';
  port?: number;
}
