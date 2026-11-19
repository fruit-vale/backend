import {
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { EmailService } from '../email/email.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ContratoService } from './contrato.service.js';

const empresa = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  razao_social: 'Fazenda Boa Vista Ltda',
  cpf_cnpj: '11.222.333/0001-81',
  responsavel: 'Maria',
  email: 'maria@fazenda.com',
  telefone: null,
  cidade: 'Petrolina',
  estado: 'PE',
  contrato_status: 'PENDENTE',
  contrato_expira_em: new Date(Date.now() + 86_400_000),
  contrato_aceito_em: null,
  contrato_aceito_nome: null,
  contrato_versao: null,
  ...extra,
});

function montar(row: ReturnType<typeof empresa> | null, count = 1) {
  const prisma = {
    empresas: {
      findUnique: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count }),
    },
  };
  const email = { enviar: vi.fn().mockResolvedValue(true), ativo: true };
  const service = new ContratoService(
    prisma as unknown as PrismaService,
    email as unknown as EmailService,
  );
  return { service, prisma, email };
}

const TOKEN = 'x'.repeat(43);

describe('ContratoService', () => {
  it('rejeita link desconhecido', async () => {
    const { service } = montar(null);
    await expect(service.consultar(TOKEN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejeita link curto sem consultar o banco', async () => {
    const { service, prisma } = montar(empresa());
    await expect(service.consultar('abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.empresas.findUnique).not.toHaveBeenCalled();
  });

  it('rejeita link expirado', async () => {
    const { service } = montar(
      empresa({ contrato_expira_em: new Date(Date.now() - 1000) }),
    );
    await expect(service.consultar(TOKEN)).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it('mostra os dados da empresa e as cláusulas', async () => {
    const { service } = montar(empresa());
    const dados = await service.consultar(TOKEN);
    expect(dados.status).toBe('PENDENTE');
    expect(dados.contratante.razao_social).toBe('Fazenda Boa Vista Ltda');
    expect(dados.clausulas.length).toBeGreaterThan(5);
  });

  it('registra o aceite com nome, IP e versão', async () => {
    const { service, prisma } = montar(empresa());
    const r = await service.aceitar(TOKEN, 'Maria da Silva', '200.1.2.3');
    expect(r.status).toBe('ACEITO');
    const chamada = prisma.empresas.updateMany.mock.calls[0][0];
    expect(chamada.where.contrato_status).toBe('PENDENTE');
    expect(chamada.data).toMatchObject({
      contrato_status: 'ACEITO',
      contrato_aceito_nome: 'Maria da Silva',
      contrato_aceito_ip: '200.1.2.3',
    });
  });

  it('não aceita duas vezes', async () => {
    const { service } = montar(empresa({ contrato_status: 'ACEITO' }));
    await expect(
      service.aceitar(TOKEN, 'Maria da Silva', null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('dois cliques simultâneos registram um só aceite', async () => {
    const { service } = montar(empresa(), 0);
    await expect(
      service.aceitar(TOKEN, 'Maria da Silva', null),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('emite o link, guarda só o hash e envia ao e-mail da empresa', async () => {
    const { service, prisma, email } = montar(empresa());
    const r = await service.emitir(1);
    expect(r.enviado).toBe(true);

    const gravado = prisma.empresas.update.mock.calls[0][0].data;
    expect(gravado.contrato_token_hash).toMatch(/^[0-9a-f]{64}$/);

    const msg = email.enviar.mock.calls[0][0];
    expect(msg.para).toBe('maria@fazenda.com');
    const token = /\/contrato\/([\w-]+)/.exec(msg.texto)![1];
    expect(token).not.toBe(gravado.contrato_token_hash);
    expect(msg.html).toContain('Fazenda Boa Vista Ltda');
  });

  it('não emite contrato para empresa que já aceitou', async () => {
    const { service } = montar(empresa({ contrato_status: 'ACEITO' }));
    await expect(service.emitir(1)).rejects.toBeInstanceOf(ConflictException);
  });
});
