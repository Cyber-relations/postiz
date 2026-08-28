import { PostgresStore } from '@mastra/pg';

export const pStore = new PostgresStore({
  id: 'postiz-store',
  connectionString: process.env.DATABASE_URL!,
  schemaName: 'mastra',
  // toybaco_mastra_schema_boundary: bootstrap task owns Mastra schema initialization.
  disableInit: process.env.MASTRA_DISABLE_STORAGE_INIT === 'true',
});
