const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const morgan = require('morgan'); // Para logging
const helmet = require('helmet'); // Para segurança
const compression = require('compression'); // Para compressão de respostas
const path = require('path');

// Configurações
const config = {
  port: process.env.PORT || 8000,
  dbPath: process.env.DB_PATH || 'database/database.db',
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

// Classe para gerenciar conexão com banco de dados
class DatabaseManager {
  constructor (dbPath) {
    this.db = null;
    this.dbPath = dbPath;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(
        this.dbPath,
        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          console.log('Conectado ao banco de dados SQLite');
          resolve();
        }
      );
    });
  }

  async query(sql, params = [], timeout = config.timeout) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('DATABASE_TIMEOUT'));
      }, timeout);

      this.db.all(sql, params, (err, rows) => {
        clearTimeout(timeoutId);
        if (err) {
          reject(err);
          return;
        }
        resolve(rows);
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// Middleware para tratamento de erros
const errorHandler = (err, req, res, next) => {
  console.error('Erro:', err);

  const errorResponse = {
    status: 'error',
    message: 'Erro interno do servidor'
  };

  if (config.nodeEnv === 'development') {
    errorResponse.detail = err.message;
    errorResponse.stack = err.stack;
  }

  if (err.message === 'DATABASE_TIMEOUT') {
    return res.status(HTTP_STATUS.TIMEOUT).json({
      status: 'error',
      message: 'A consulta excedeu o tempo limite de 3 minutos'
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(errorResponse);
};

// Inicialização do banco de dados
const dbManager = new DatabaseManager(config.dbPath);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(morgan('dev')); // Logging
app.use(helmet()); // Segurança
app.use(compression()); // Compressão

// Middleware para verificar conexão com banco
const checkDatabaseConnection = async (req, res, next) => {
  if (!dbManager.db) {
    try {
      await dbManager.connect();
      next();
    } catch (error) {
      next(new Error('Falha na conexão com o banco de dados'));
    }
  } else {
    next();
  }
};

/** Traz resultados de uma tabela especificada com limit de 10 linhas, passando o nome da tabela por parâmetro
  * Exemplo 1: http://localhost:8000/api/table/NOMEDATABELA
*/
app.get('/api/table/:table', checkDatabaseConnection, async (req, res, next) => {
  const { table } = req?.params; // Obtém o nome da tabela da URL

  const sql = `SELECT * FROM ${table} LIMIT 10`;

  try {
      const resultado = await dbManager.query(sql);
      res.status(HTTP_STATUS.OK).json({
          status: 'success',
          data: resultado
      });
  } catch (error) {
      if (error?.message?.includes('no such table')) {
          next(new Error(error.message.replace('no such table:', 'Não existe a tabela:')));
      } else {
          next(new Error(error.message));
      }
  }
});

// Rota padrão para endpoints não encontrados
app.use('*', (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    status: 'error',
    message: 'Endpoint não encontrado'
  });
});

// Error handling middleware
app.use(errorHandler);

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
