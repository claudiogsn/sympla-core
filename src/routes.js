'use strict';

const express = require('express');
const sympla = require('./symplaClient');
const eventosRepo = require('./eventosRepo');
const partRepo = require('./participantesRepo');
const totemCfgRepo = require('./totemConfigRepo');
const produtoresRepo = require('./produtoresRepo');

const router = express.Router();

// ---------------------------------------------------------------------
//  Middleware: resolve :eventoId e carrega as credenciais do evento.
//  Anexa req.credenciais = { id, sympla_event_id, sympla_token }.
// ---------------------------------------------------------------------
async function carregarEvento(req, res, next) {
  try {
    const cred = await eventosRepo.getCredenciais(req.params.eventoId);
    if (!cred) {
      return res.status(404).json({ ok: false, erro: 'Evento não encontrado.' });
    }
    req.credenciais = cred;
    next();
  } catch (err) {
    next(err);
  }
}

// =====================================================================
//  PRODUTORES  (área administrativa — proteja com auth, ver server.js)
// =====================================================================

/**
 * POST /api/produtores
 * Body: { nome?, sympla_token }
 * Valida o token na Sympla e cadastra o produtor.
 */
router.post('/produtores', async (req, res, next) => {
  try {
    const { nome, sympla_token } = req.body || {};
    if (!sympla_token || !String(sympla_token).trim()) {
      return res.status(400).json({ ok: false, erro: 'sympla_token é obrigatório.' });
    }

    // Valida o token: se conseguir listar eventos, o token funciona.
    try {
      await sympla.fetchEventosDaConta(sympla_token.trim());
    } catch (err) {
      return res.status(502).json({
        ok: false,
        erro: 'Não foi possível validar o token na Sympla.',
        detalhe: err.message,
      });
    }

    const produtor = await produtoresRepo.criar({
      nome: (nome || '').trim(),
      sympla_token: sympla_token.trim(),
    });
    res.status(201).json({ ok: true, produtor });
  } catch (err) {
    next(err);
  }
});

/** GET /api/produtores — lista os produtores (sem token). */
router.get('/produtores', async (req, res, next) => {
  try {
    res.json({ ok: true, produtores: await produtoresRepo.listar() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/produtores/:id — detalhe de um produtor (sem token). */
router.get('/produtores/:id', async (req, res, next) => {
  try {
    const produtor = await produtoresRepo.buscarPublico(req.params.id);
    if (!produtor) {
      return res.status(404).json({ ok: false, erro: 'Produtor não encontrado.' });
    }
    res.json({ ok: true, produtor });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/produtores/:id/eventos
 * Eventos JÁ importados para a nossa base, deste produtor.
 */
router.get('/produtores/:id/eventos', async (req, res, next) => {
  try {
    const eventos = await eventosRepo.listarPorProdutor(req.params.id);
    res.json({ ok: true, eventos });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/produtores/:id/sympla-eventos
 * Busca na Sympla todos os eventos da conta deste produtor, marcando
 * quais já foram importados (campo `importado`).
 */
router.get('/produtores/:id/sympla-eventos', async (req, res, next) => {
  try {
    const cred = await produtoresRepo.getToken(req.params.id);
    if (!cred) {
      return res.status(404).json({ ok: false, erro: 'Produtor não encontrado.' });
    }

    let brutos;
    try {
      brutos = await sympla.fetchEventosDaConta(cred.sympla_token);
    } catch (err) {
      const status = err.code === 'RATE_LIMIT' ? 429 : 502;
      return res.status(status).json({ ok: false, erro: err.message });
    }

    const importados = await eventosRepo.listarPorProdutor(req.params.id);
    const idsImportados = new Set(importados.map(e => String(e.sympla_event_id)));

    const eventos = brutos.map(ev => ({
      sympla_event_id: String(ev.id),
      nome: ev.name || ev.nome || '',
      local: (ev.address && (ev.address.name || ev.address.city)) || '',
      data_inicio: ev.start_date || null,
      data_fim: ev.end_date || null,
      importado: idsImportados.has(String(ev.id)),
    }));

    res.json({ ok: true, eventos });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/produtores/:id/importar
 * Body: { sympla_event_id }
 * Cria o evento na base e roda o primeiro sync de participantes.
 */
router.post('/produtores/:id/importar', async (req, res, next) => {
  try {
    const { sympla_event_id } = req.body || {};
    if (!sympla_event_id) {
      return res.status(400).json({ ok: false, erro: 'sympla_event_id é obrigatório.' });
    }

    const cred = await produtoresRepo.getToken(req.params.id);
    if (!cred) {
      return res.status(404).json({ ok: false, erro: 'Produtor não encontrado.' });
    }

    // Evita importar o mesmo evento duas vezes.
    const jaExiste = await eventosRepo.existePorSymplaId(req.params.id, sympla_event_id);
    if (jaExiste) {
      return res.status(409).json({
        ok: false,
        erro: 'Este evento já foi importado.',
        evento_id: jaExiste.id,
      });
    }

    // Busca os dados do evento na Sympla.
    let dados;
    try {
      dados = await sympla.fetchEvento(cred.sympla_token, sympla_event_id);
    } catch (err) {
      const status = err.code === 'RATE_LIMIT' ? 429 : 502;
      return res.status(status).json({ ok: false, erro: err.message });
    }

    const evento = await eventosRepo.criar({
      produtor_id: Number(req.params.id),
      sympla_event_id: String(sympla_event_id),
      nome: dados.name || dados.nome || '',
      local: (dados.address && dados.address.name) || dados.local || '',
      data_inicio: dados.start_date || dados.data_inicio || null,
      data_fim: dados.end_date || dados.data_fim || null,
    });

    // Primeiro sync dos participantes.
    let sincronizados = 0;
    try {
      const lista = await sympla.fetchAllParticipants(
          cred.sympla_token, sympla_event_id
      );
      sincronizados = await partRepo.upsertParticipantes(evento.id, lista);
      await eventosRepo.registrarSync(evento.id, sincronizados);
    } catch (err) {
      // O evento foi criado; o sync pode ser refeito depois manualmente.
      return res.status(207).json({
        ok: true,
        evento,
        sincronizados: 0,
        aviso: 'Evento importado, mas o primeiro sync falhou: ' + err.message,
      });
    }

    res.status(201).json({ ok: true, evento, sincronizados });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eventos — lista todos os eventos cadastrados (sem token). */
router.get('/eventos', async (req, res, next) => {
  try {
    res.json({ ok: true, eventos: await eventosRepo.listar() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eventos/:eventoId — detalhe de um evento (sem token). */
router.get('/eventos/:eventoId', async (req, res, next) => {
  try {
    const evento = await eventosRepo.buscarPublico(req.params.eventoId);
    if (!evento) return res.status(404).json({ ok: false, erro: 'Evento não encontrado.' });
    res.json({ ok: true, evento });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/eventos/:eventoId/sync
 * Puxa todos os participantes do evento da Sympla para o MySQL.
 */
router.post('/eventos/:eventoId/sync', carregarEvento, async (req, res, next) => {
  try {
    const { id, sympla_event_id, sympla_token } = req.credenciais;
    const lista = await sympla.fetchAllParticipants(sympla_token, sympla_event_id);
    const total = await partRepo.upsertParticipantes(id, lista);
    await eventosRepo.registrarSync(id, total);
    res.json({ ok: true, sincronizados: total });
  } catch (err) {
    if (err.code === 'RATE_LIMIT') {
      return res.status(429).json({ ok: false, erro: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/eventos/:eventoId/totem-config
 * Devolve a configuração do totem/etiqueta (ou os defaults, se nova).
 * Usada tanto pela tela de configuração quanto pela interface do totem.
 */
router.get('/eventos/:eventoId/totem-config', carregarEvento, async (req, res, next) => {
  try {
    const config = await totemCfgRepo.obter(req.credenciais.id);
    res.json({ ok: true, config });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/eventos/:eventoId/totem-config
 * Cria ou atualiza a configuração do totem/etiqueta. Aceita objeto parcial.
 * (Rota administrativa — proteja com auth, ver server.js.)
 */
router.put('/eventos/:eventoId/totem-config', carregarEvento, async (req, res, next) => {
  try {
    const config = await totemCfgRepo.salvar(req.credenciais.id, req.body || {});
    res.json({ ok: true, config });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
//  ÁREA DO TOTEM  (consumida pela interface /toten/{eventoId})
// =====================================================================

/**
 * GET /api/eventos/:eventoId/search?q=termo&limit=10
 * Autocomplete: busca enxuta por nome, e-mail ou ticket.
 */
router.get('/eventos/:eventoId/search', carregarEvento, async (req, res, next) => {
  try {
    const resultados = await partRepo.buscar(
        req.credenciais.id, req.query.q, req.query.limit
    );
    res.json({ ok: true, resultados });
  } catch (err) {
    next(err);
  }
});

/** GET /api/eventos/:eventoId/status — contadores para o painel. */
router.get('/eventos/:eventoId/status', carregarEvento, async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await partRepo.contadores(req.credenciais.id)) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/eventos/:eventoId/participantes/:pid
 * Detalhe completo de um participante.
 */
router.get(
    '/eventos/:eventoId/participantes/:pid',
    carregarEvento,
    async (req, res, next) => {
      try {
        const p = await partRepo.buscarDetalhe(req.credenciais.id, req.params.pid);
        if (!p) {
          return res.status(404).json({ ok: false, erro: 'Participante não encontrado.' });
        }
        res.json({ ok: true, participante: p });
      } catch (err) {
        next(err);
      }
    }
);

/**
 * POST /api/eventos/:eventoId/checkin
 * Body: { ticket_number, origem? }
 */
router.post('/eventos/:eventoId/checkin', carregarEvento, async (req, res, next) => {
  const { id, sympla_event_id, sympla_token } = req.credenciais;
  const ticket = ((req.body && req.body.ticket_number) || '').trim();
  const origem = (req.body && req.body.origem) || '';

  if (!ticket) {
    return res.status(400).json({ ok: false, erro: 'ticket_number é obrigatório.' });
  }

  try {
    const participante = await partRepo.buscarPorTicket(id, ticket);

    // Caso 1: ingresso não está na base.
    if (!participante) {
      await partRepo.registrarLog({
        eventoId: id, ticketNumber: ticket,
        resultado: 'NAO_ENCONTRADO', origem,
      });
      return res.status(404).json({
        ok: false,
        resultado: 'NAO_ENCONTRADO',
        mensagem: 'Ingresso não encontrado. Sincronize ou confira o código.',
      });
    }

    // Caso 2: ingresso já utilizado.
    if (participante.checkin_status === 'CHECKED_IN') {
      await partRepo.registrarLog({
        eventoId: id, participanteId: participante.id, ticketNumber: ticket,
        resultado: 'JA_UTILIZADO', origem,
      });
      return res.status(409).json({
        ok: false,
        resultado: 'JA_UTILIZADO',
        mensagem: 'Este ingresso já fez check-in.',
        participante,
      });
    }

    // Caso 3: check-in válido — confirma na Sympla (fonte de verdade).
    // Usa o ticket_number canônico do registro (não o que foi digitado/
    // escaneado), pois a busca pode ter sido feita pelo código do QR.
    try {
      await sympla.checkInByTicketNumber(
          sympla_token, sympla_event_id, participante.ticket_number
      );
    } catch (err) {
      await partRepo.registrarLog({
        eventoId: id, participanteId: participante.id, ticketNumber: ticket,
        resultado: 'ERRO_SYMPLA', origem, detalhe: err.message.slice(0, 240),
      });
      const status = err.code === 'RATE_LIMIT' ? 429 : 502;
      return res.status(status).json({
        ok: false,
        resultado: 'ERRO_SYMPLA',
        mensagem: err.message,
        participante,
      });
    }

    await partRepo.marcarCheckin(participante.id);
    await partRepo.registrarLog({
      eventoId: id, participanteId: participante.id, ticketNumber: ticket,
      resultado: 'CHECKIN_OK', origem,
    });

    res.json({
      ok: true,
      resultado: 'CHECKIN_OK',
      mensagem: 'Check-in confirmado.',
      participante: { ...participante, checkin_status: 'CHECKED_IN' },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;