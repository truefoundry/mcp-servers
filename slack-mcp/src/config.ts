import { config as dotenvConfig } from 'dotenv';

// Load environment variables
dotenvConfig();

export const config = {
  port: Number(process.env.PORT) || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
} as const;
