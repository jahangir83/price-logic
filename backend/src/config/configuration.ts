export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  shopify: {
    apiKey: string;
    clientSecret: string;
    scopes: string;
    appUrl: string;
    apiVersion: string;
  };
  session: {
    secret: string;
    ttlDays: number;
  };
  encryptionKey: string;
  frontendUrl: string;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL as string,
  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY as string,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET as string,
    scopes: process.env.SHOPIFY_SCOPES as string,
    appUrl: process.env.SHOPIFY_APP_URL as string,
    apiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-01',
  },
  session: {
    secret: process.env.SESSION_SECRET as string,
    ttlDays: parseInt(process.env.SESSION_TTL_DAYS ?? '7', 10),
  },
  encryptionKey: process.env.ENCRYPTION_KEY as string,
  frontendUrl: process.env.FRONTEND_URL as string,
});
