'use strict';

/**
 * Cliente da API pública da Sympla (v1.5.0).
 *
 * Diferente da versão anterior: nada de token fixo em variável de ambiente.
 * Cada função recebe o `token` e o `symplaEventId` do evento em questão,
 * pois o sistema agora é multi-evento e cada evento tem suas credenciais.
 */

const BASE_URL = 'https://api.sympla.com.br/public/v1.5.0';

/**
 * Requisição base à API Sympla.
 */
async function symplaRequest(token, path, { method = 'GET' } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      's_token': token,
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 429) {
    const err = new Error('Rate limit da Sympla atingido (HTTP 429).');
    err.code = 'RATE_LIMIT';
    err.status = 429;
    throw err;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Sympla respondeu ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Busca os dados básicos de um evento na Sympla.
 * Usado pela tela de configuração ao cadastrar um evento novo.
 */
async function fetchEvento(token, symplaEventId) {
  const resp = await symplaRequest(token, `/events/${symplaEventId}`);
  // A API devolve o evento em `data` (objeto) ou diretamente.
  return resp.data || resp;
}

/**
 * Lista TODOS os eventos da conta dona do token, percorrendo a paginação.
 * Usado para o produtor escolher quais eventos importar.
 */
async function fetchEventosDaConta(token) {
  const todos = [];
  let page = 1;
  let totalPage = 1;

  do {
    const resp = await symplaRequest(
        token,
        `/events?page=${page}&page_size=100`
    );
    const data = Array.isArray(resp.data) ? resp.data : [];
    todos.push(...data);

    const pg = resp.pagination || {};
    totalPage = pg.total_page || 1;
    page += 1;
  } while (page <= totalPage);

  return todos;
}

/**
 * Busca TODOS os participantes de um evento, percorrendo a paginação.
 */
async function fetchAllParticipants(token, symplaEventId) {
  const todos = [];
  let page = 1;
  let totalPage = 1;

  do {
    const resp = await symplaRequest(
        token,
        `/events/${symplaEventId}/participants?page=${page}&page_size=200`
    );

    const data = Array.isArray(resp.data) ? resp.data : [];
    todos.push(...data);

    const pg = resp.pagination || {};
    totalPage = pg.total_page || 1;
    page += 1;
  } while (page <= totalPage);

  return todos;
}

/**
 * Realiza o check-in de um participante pelo número do ingresso.
 */
async function checkInByTicketNumber(token, symplaEventId, ticketNumber) {
  const encoded = encodeURIComponent(ticketNumber);
  return symplaRequest(
      token,
      `/events/${symplaEventId}/participants/${encoded}/checkin`,
      { method: 'POST' }
  );
}

module.exports = {
  BASE_URL,
  fetchEvento,
  fetchEventosDaConta,
  fetchAllParticipants,
  checkInByTicketNumber,
};