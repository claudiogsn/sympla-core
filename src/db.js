'use strict';

/**
 * Pool de conexão MySQL (mysql2/promise).
 * O pool reaproveita conexões — importante para um backend que atende
 * vários totens simultaneamente.
 */

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sympla_checkin',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'Z',
});

module.exports = pool;