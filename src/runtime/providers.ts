import 'dotenv/config';
import OpenAI from 'openai';
import { Daytona } from '@daytona/sdk';

export function createOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in your local .env');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function createDaytonaClient(): Daytona {
  if (!process.env.DAYTONA_API_KEY) throw new Error('Set DAYTONA_API_KEY for app-runtime SDK access');
  return new Daytona({ apiKey: process.env.DAYTONA_API_KEY, apiUrl: 'https://app.daytona.io/api', target: process.env.DAYTONA_TARGET || 'eu' });
}
