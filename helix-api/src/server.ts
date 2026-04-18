import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
