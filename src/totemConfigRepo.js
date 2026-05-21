'use strict';

/**
 * Repositório da tabela `totem_config`.
 * Um registro por evento. Se ainda não existir, devolvemos os defaults.
 */

const pool = require('./db');

/** Campos editáveis e seus valores-padrão. */
const DEFAULTS = {
    cor_primaria: '#1A2B4C',
    cor_secundaria: '#F26522',
    logo_url: '',
    banner_url: '',
    titulo_totem: 'Faça seu check-in',
    subtitulo_totem: '',
    teclado_virtual: 1,
    etiqueta_largura_mm: 90.0,
    etiqueta_altura_mm: 55.0,
    etq_mostrar_nome1: 1,
    etq_mostrar_nome2: 1,
    etq_mostrar_cargo: 1,
    etq_mostrar_qrcode: 1,
    etq_mostrar_logo: 0,
};

const CAMPOS = Object.keys(DEFAULTS);

/**
 * Retorna a config de um evento. Se não houver registro ainda,
 * devolve os defaults (sem gravar) para a tela já abrir preenchida.
 */
async function obter(eventoId) {
    const [rows] = await pool.query(
        'SELECT * FROM totem_config WHERE evento_id = ? LIMIT 1',
        [eventoId]
    );
    if (rows[0]) return rows[0];
    return { evento_id: Number(eventoId), ...DEFAULTS };
}

/**
 * Cria ou atualiza a config (upsert). Aceita um objeto parcial:
 * só os campos enviados são considerados, o resto mantém o atual/default.
 */
async function salvar(eventoId, dados) {
    const atual = await obter(eventoId);

    // Mescla: começa do atual, sobrescreve com o que veio em `dados`.
    const final = {};
    for (const campo of CAMPOS) {
        final[campo] = (dados[campo] !== undefined) ? dados[campo] : atual[campo];
    }

    const colunas = ['evento_id', ...CAMPOS];
    const valores = [eventoId, ...CAMPOS.map(c => final[c])];
    const placeholders = colunas.map(() => '?').join(', ');
    const updates = CAMPOS.map(c => `${c} = VALUES(${c})`).join(', ');

    await pool.query(
        `INSERT INTO totem_config (${colunas.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
        valores
    );

    return obter(eventoId);
}

module.exports = { obter, salvar, DEFAULTS, CAMPOS };