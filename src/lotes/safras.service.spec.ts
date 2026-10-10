import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../auth/decorators.js';
import { SafrasService } from './safras.service.js';

const USER = {
  sub: 9,
  role: 'produtor',
  empresa_id: 1,
} as unknown as JwtPayload;
const PLANTIO = new Date('2026-06-01T00:00:00Z');
const COLHEITA = new Date('2026-10-01T00:00:00Z');

function montar(codigos: string[], dynsecFalha?: Error) {
  const safra = {
    id: 7,
    data_plantio: PLANTIO,
    previsao_colheita: null,
    data_colheita: COLHEITA,
    producao: null,
    unidade_producao: null,
    observacoes: null,
    culturas: { id: 1, nome: 'Manga', variedade: null },
  };
  const tx = {
    ciclos_cultivo: { update: vi.fn().mockResolvedValue(safra) },
    lotes: { update: vi.fn() },
    sensores: { updateMany: vi.fn() },
  };
  const prisma = {
    ciclos_cultivo: {
      findFirst: vi.fn().mockResolvedValue({ ...safra, data_colheita: null }),
    },
    sensores: {
      findMany: vi
        .fn()
        .mockResolvedValue(codigos.map((codigo_sensor) => ({ codigo_sensor }))),
    },
    // como o Prisma: um erro dentro da função desfaz tudo
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const lotes = {
    buscar: vi.fn().mockResolvedValue({
      id: 3,
      propriedades: { empresas: { id: 1 } },
      area_ha: null,
      ciclos_cultivo: [{ id: 7 }],
    }),
  };
  const dynsec = {
    ativarCliente: vi.fn(() =>
      dynsecFalha ? Promise.reject(dynsecFalha) : Promise.resolve(),
    ),
  };
  const redis = { remover: vi.fn() };
  const servico = new SafrasService(
    prisma as never,
    lotes as never,
    dynsec as never,
    redis as never,
  );
  return { servico, tx, dynsec, redis };
}

const colheita = {
  data_colheita: COLHEITA,
  producao: null,
  unidade_producao: null,
  observacoes: null,
};

describe('SafrasService.colher', () => {
  it('desativa e desvincula os sensores do lote, sem apagar nada', async () => {
    const { servico, tx, dynsec, redis } = montar(['emp1-a', 'emp1-b']);
    const resposta = await servico.colher(USER, 3, colheita);

    expect(tx.sensores.updateMany).toHaveBeenCalledWith({
      where: { lote_id: 3 },
      data: { status: 'INATIVO', lote_id: null },
    });
    expect(dynsec.ativarCliente).toHaveBeenCalledWith('emp1-a', false);
    expect(dynsec.ativarCliente).toHaveBeenCalledWith('emp1-b', false);
    expect(redis.remover).toHaveBeenCalledWith('sensor:emp1-a');
    expect(redis.remover).toHaveBeenCalledWith('sensor:emp1-b');
    expect(resposta.sensores_desativados).toEqual(['emp1-a', 'emp1-b']);
    expect(tx.lotes.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { situacao: 'COLHIDO' },
    });
  });

  it('lote sem sensores: colhe normalmente', async () => {
    const { servico, dynsec } = montar([]);
    const resposta = await servico.colher(USER, 3, colheita);
    expect(dynsec.ativarCliente).not.toHaveBeenCalled();
    expect(resposta.sensores_desativados).toEqual([]);
  });

  it('sensor sem login no broker não impede a colheita', async () => {
    const { servico } = montar(['emp1-a'], new NotFoundException());
    await expect(servico.colher(USER, 3, colheita)).resolves.toBeDefined();
  });

  it('broker fora do ar: a colheita falha (e a transação é desfeita)', async () => {
    const { servico, redis } = montar(['emp1-a'], new Error('broker offline'));
    await expect(servico.colher(USER, 3, colheita)).rejects.toThrow(
      'broker offline',
    );
    expect(redis.remover).not.toHaveBeenCalled();
  });
});
