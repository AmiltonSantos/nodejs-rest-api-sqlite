require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const morgan = require('morgan'); // Para logging
const helmet = require('helmet'); // Para segurança
const compression = require('compression'); // Para compressão de respostas
const path = require('path');
const cors = require('cors');

// Configurações
const config = {
  port: process.env.PORT || 4000,
  dbPath: process.env.DB_PATH || 'database/database.db',
  timeout: process.env.query_TIMEOUT || 3 * 60 * 1000, // 3 minutos
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

const corsOptions = {
  origin: 'https://nodejs-rest-api-sqlite.vercel.app/', // Substitua pelo seu domínio
  optionsSuccessStatus: 200 // Para navegadores antigos
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
app.use(cors(corsOptions));

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

// Rota da pagina home onde vai abri a pagina inicial do app
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

/** Pesquisando em uma tabela especifica passada por parâmetro e um ID
    * Exemplo 1: http://localhost:8000/api/table/users/25
*/
app.get('/api/table/:table/:id', checkDatabaseConnection, async (req, res, next) => {
  const { table, id } = req?.params;

  if (!table && !id) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 'message': 'Bad request. Missing ID parameter' });
  }

  const sql = `SELECT * FROM ${table} WHERE id = ?`;
  const params = [id];

  try {
    const row = await dbManager.query(sql, params);
    if (row.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ "message": "User not found" });
    }
    res.status(HTTP_STATUS.OK).json(row[0]); // Retorna o primeiro usuário encontrado
  } catch (error) {
    if (error?.message?.includes('no such table')) {
      next(new Error(error.message.replace('no such table:', 'Não existe a tabela:')));
    } else {
      next(new Error(error.message));
    }
  }
});

/** Pesquisando passando uma tabela especifica, e com parâmetros de "page" e "limit"
    * Exemplo 1: http://localhost:8000/api/pagination/users?page=1&limit=10
*/
app.get('/api/pagination/:table', checkDatabaseConnection, async (req, res, next) => {
  const { table } = req?.params;
  const { page, limit } = req?.query;

  // Verifica se os parâmetros de página e limite estão presentes
  if (!page || !limit) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 'message': 'Bad request. Missing page or limit parameter' });
  }

  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const offset = (pageNumber - 1) * limitNumber;

  const sql = `SELECT * FROM ${table} LIMIT ? OFFSET ?`;
  const params = [limitNumber, offset];

  try {
    const rows = await dbManager.query(sql, params);
    if (rows.length > 0) {
      res.setHeader('Content-Type', 'application/json');
      res.status(HTTP_STATUS.OK).json(rows);
    } else {
      res.status(HTTP_STATUS.OK).json({
        "message": `A tabela '${table}' está vazia.`
      });
    }
  } catch (error) {
    if (error?.message?.includes('no such table')) {
      next(new Error(error.message.replace('no such table:', 'Não existe a tabela:')));
    } else {
      next(new Error(error.message));
    }
  }
});

/** Atualiza um cadastro existente passando o ID. 
    * Exemplo 1: http://localhost:8000/api/table/users/1
    * Modelo de Exemplo no body:
    {
        "name": "Amilton Santos Gomes",
        "email": "amilton@a1000ton.com"
    }
*/
app.patch('/api/table/:table/:id', checkDatabaseConnection, async (req, res, next) => {
  const { table, id } = req?.params; // Obtém o nome da tabela da URL

  let [keys, values] = [[], []];

  if (Object.keys(req?.body).length > 0) {
    for (const [key, value] of Object.entries(req?.body)) {
      keys.push(key.concat(' = ?'));
      values.push(value);
    }
  }

  const sql = `UPDATE ${table} SET ${keys.join()} WHERE id = ?`;
  const params = values.concat(id);

  try {
    await dbManager.query(sql, params);
    res.status(HTTP_STATUS.OK).json({ message: `Cadastro atualizado com sucesso!`, changes: this.changes });
  } catch (error) {
    if (error?.message?.includes('no such table')) {
      next(new Error(error.message.replace('no such table:', 'Não existe a tabela:')));
    } else {
      next(new Error(error.message));
    }
  }
});

/** Deletar um cadastro em uma tabala especifica passando um ID
    * Exemplo 1: http://localhost:8000/api/table/users/25
*/
app.delete('/api/table/:table/:id', checkDatabaseConnection, async (req, res, next) => {
  const { table, id } = req?.params;

  // Primeiro, verifique se o registro existe
  const checkSql = `SELECT * FROM ${table} WHERE id = ?`;

  // Se o registro existir, prossiga com a exclusão
  const deleteSql = `DELETE FROM ${table} WHERE id = ?`;
  const checkParams = [id];

  try {
    const result = await dbManager.query(checkSql, checkParams);

    // Se não houver resultado, o registro não existe
    if (result.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ message: `O id '${id}' não encontrado na tabela '${table}'.` });
    }

    await dbManager.query(deleteSql, checkParams);
    res.status(HTTP_STATUS.OK).json({ message: `ID '${id}' excluído com sucesso!` });
  } catch (error) {
    if (error?.message?.includes('no such table')) {
      next(new Error(error.message.replace('no such table:', 'Não existe a tabela:')));
    } else {
      next(new Error(error.message));
    }
  }
});

/** Cria um novo cadastro
  * Exemplo 1: http://localhost:8000/api/table/users
  * Modelo de Exemplo no body:
    {
        "name": "Amilton Santos",
        "email": "amilton@a1000ton.com"
    }
*/
app.post('/api/table/:table', checkDatabaseConnection, async (req, res, next) => {
  const { table } = req?.params; // Obtém o nome da tabela da URL

  let [keys, values, i] = [[], [], []];

  if (Object.keys(req?.body).length > 0) {
    for (const [key, value] of Object.entries(req?.body)) {
      keys.push(key);
      values.push(value);
      i.push('?');
    }
  }

  const sql = `INSERT INTO ${table} (${keys.join()}) VALUES (${i.join()})`;
  const params = values;

  try {
    await dbManager.query(sql, params);
    res.status(HTTP_STATUS.OK).json({ message: `Cadastro criado com sucesso!`, id: this.lastID });
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed')) {
      next(new Error('O email já existe'));
    } else {
      next(new Error(error.message));
    }
  }
});

/**  Endpoint para criar uma nova tabela no banco de dados SQLite
    * Exempplo 1: http://localhost:8000/api/table/users/add-column  
    * Modelo de Exemplo no body:
    {
        "tableName": "Users2",
        "columns": "id INTEGER PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL, dept INTEGER"
    } 
*/
app.post('/api/table/create-table', checkDatabaseConnection, async (req, res, next) => {
  const { tableName, columns } = req?.body;

  if (!tableName || !columns) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Nome da tabela e colunas são obrigatórios.' });
  }

  const createTableSQL = `CREATE TABLE IF NOT EXISTS ${tableName} (${columns});`;

  try {
    await dbManager.query(createTableSQL);
    res.status(HTTP_STATUS.OK).json({ message: `Tabela '${tableName}' criada com sucesso!` });
  } catch (error) {
    console.error(error.message);
    next(new Error('Erro ao criar a tabela: ' + error.message));
  }
});

/**  Criar uma nova coluna em uma tabela especifica no banco de dados SQLite
    * Exempplo 1: http://localhost:8000/api/table/add-column/users  
    * Modelo de Exemplo no body:
    {
        "columnName": "age",
        "columnType": "INTEGER"
    }
*/
app.post('/api/table/add-column/:table', checkDatabaseConnection, async (req, res, next) => {
  const { table } = req?.params;
  const { columnName, columnType } = req?.body; // Obtem o nome da coluna e o tipo no corpo da solicitação

  // Construa a instrução SQL
  const sql = `ALTER TABLE ${table} ADD COLUMN ${columnName} ${columnType};`;

  try {
    await dbManager.query(sql);
    res.status(HTTP_STATUS.OK).json({ message: `Coluna '${columnName}' criada com sucesso!` });
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

// Tratamento do Sinal de Interrupção (SIGINT) para Encerramento Limpo
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

// Tratamento de Rejeições Não Tratadas em Promessas
process.on('unhandledRejection', (reason, promise) => {
  console.error('Rejeição não tratada:', reason);
  dbManager.close();
  process.exit(1);
});
