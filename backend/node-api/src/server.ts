import { buildApp } from './app.js';
import { loadEnvironment } from './config/environment.js';

const environment = loadEnvironment();
const app = await buildApp({ environment });

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Encerrando a API com segurança.');

  try {
    await app.close();
    process.exitCode = 0;
  } catch (error) {
    app.log.error({ err: error }, 'Falha durante o encerramento da API.');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({
    host: environment.host,
    port: environment.port,
  });
} catch (error) {
  app.log.fatal({ err: error }, 'A API não conseguiu iniciar.');
  await app.close();
  process.exitCode = 1;
}
