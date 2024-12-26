const express = require('express');
const app = express();

// Configurações
const config = {
  port: process.env.PORT || 8000,
  timeout: process.env.QUERY_TIMEOUT || 3 * 60 * 1000, // 3 minutos
  nodeEnv: process.env.NODE_ENV || 'development'
};

// Status HTTP
const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  TIMEOUT: 408,
  INTERNAL_SERVER_ERROR: 500
};

// Rota padrão para endpoints não encontrados
app.use('*', (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
      status: 'error',
      message: 'Endpoint não encontrado'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('Recebido SIGTERM. Encerrando...');
    dbManager.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('Recebido SIGINT. Encerrando...');
    dbManager.close();
    process.exit(0);
});

// Iniciando servidor
app.listen(config.port, () => {
    console.log(`Servidor rodando na porta ${config.port}`);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
    console.error('Erro não capturado:', error);
    dbManager.close();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rejeição não tratada:', reason);
    dbManager.close();
    process.exit(1);
});
