import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().uri().required(),

  SHOPIFY_API_KEY: Joi.string().required(),
  SHOPIFY_CLIENT_SECRET: Joi.string().required(),
  SHOPIFY_SCOPES: Joi.string().required(),
  SHOPIFY_APP_URL: Joi.string().uri().required(),
  SHOPIFY_API_VERSION: Joi.string().default('2025-01'),

  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_TTL_DAYS: Joi.number().default(7),

  // Must be a base64-encoded 32-byte key (AES-256-GCM).
  ENCRYPTION_KEY: Joi.string().required(),

  FRONTEND_URL: Joi.string().uri().required(),
});
