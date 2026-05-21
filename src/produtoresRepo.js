'use strict';

/**
 * Repositório da tabela `produtores`.
 * Cada produtor representa uma conta Sympla (um token).
 *
 * Regra de segurança: `sympla_token` nunca é devolvido pelas funções
 * de listagem. Só `getToken` o retorna, para uso interno do backend.
 */

const pool = require('./db');

/** Remove o token antes de devolver ao cliente. */
function toPublico(row) {
    if (!row) return null;
    const { sympla_token, ...publico } = row;
    return publico;
}

/** Lista todos os produtores (sem token). */
async function listar() {
    const [rows] = await pool.query(
        `SELECT p.*,
       (SELECT COUNT(*) FROM eventos e WHERE e.produtor_id = p.id) AS total_eventos
     FROM produtores p
     ORDER BY p.nome`
    );
    return rows.map(toPublico);
}

/** Busca um produtor pelo id (sem token). */
async function buscarPublico(id) {
    const [rows] = await pool.query(
        'SELECT * FROM produtores WHERE id = ? LIMIT 1',
        [id]
    );
    return toPublico(rows[0]);
}

/**
 * Retorna o token de um produtor. USO INTERNO — nunca exponha.
 */
async function getToken(id) {
    const [rows] = await pool.query(
        'SELECT id, sympla_token FROM produtores WHERE id = ? LIMIT 1',
        [id]
    );
    return rows[0] || null;
}

/** Cadastra um produtor novo. */
async function criar({ nome, sympla_token }) {
    const [result] = await pool.query(
        'INSERT INTO produtores (nome, sympla_token) VALUES (?, ?)',
        [nome || '', sympla_token]
    );
    return buscarPublico(result.insertId);
}

module.exports = {
    listar,
    buscarPublico,
    getToken,
    criar,
};