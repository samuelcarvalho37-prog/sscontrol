import { loadEnvironment } from './src/config/environment.js';
import { migrateDatabase } from './src/infrastructure/database/migrator.js';

try {
  const env = loadEnvironment();
  const result = await migrateDatabase(env);
  console.log('OK', result);
} catch (e) {
  console.error('ERRO REAL:', e);
}