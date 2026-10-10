import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '../auth/decorators.js';
import { SensoresService } from './sensores.service.js';

const USER = {
  sub: 9,
  role: 'produtor',
  empresa_id: 1,
} as unknown as JwtPayload;

/** Serviço com o lote informado; o resto do cadastro não chega a rodar. */
function montar(situacao: string | null) {
  const prisma = {
    lotes: {
      findFirst: vi.fn().mockResolvedValue({
        id: 2,
        nome_identificacao: 'Lote B2',
        situacao,
        propriedades: { id: 1, nome: 'Fazenda', empresa_id: 1 },
      }),
    },
    sensores: {
      // o cadastro para aqui: basta saber se passou da checagem do lote
      findUnique: vi.fn().mockRejectedValue(new Error('passou da checagem')),
      findFirst: vi.fn().mockResolvedValue({
        id: 5,
        codigo_sensor: 'emp1-a',
        propriedades: { empresa_id: 1 },
      }),
      update: vi.fn().mockRejectedValue(new Error('passou da checagem')),
    },
  };
  return new SensoresService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const novo = {
  identificador: 'a',
  tipo: 'DHT22',
  lote_id: 2,
  data_instalacao: null,
  medidas: [],
};

describe('sensor só entra em lote em cultivo', () => {
  it.each([
    ['EM_PREPARO', /em preparo/],
    ['COLHIDO', /já foi colhido/],
  ])('recusa cadastrar em lote %s', async (situacao, mensagem) => {
    const erro = montar(situacao).criar(USER, novo);
    await expect(erro).rejects.toBeInstanceOf(BadRequestException);
    await expect(erro).rejects.toThrow(mensagem);
  });

  it.each(['EM_CULTIVO', null])(
    'aceita cadastrar em lote %s',
    async (situacao) => {
      await expect(montar(situacao).criar(USER, novo)).rejects.toThrow(
        'passou da checagem',
      );
    },
  );

  it('recusa mudar o sensor para lote em preparo', async () => {
    await expect(
      montar('EM_PREPARO').moverParaLote(USER, 5, 2),
    ).rejects.toThrow(/em preparo/);
  });

  it('aceita mudar o sensor para lote em cultivo', async () => {
    await expect(
      montar('EM_CULTIVO').moverParaLote(USER, 5, 2),
    ).rejects.toThrow('passou da checagem');
  });
});
