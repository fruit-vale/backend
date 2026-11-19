import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../email/email.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CONTRATO_VERSAO,
  clausulas,
  contratada,
  hashDoTexto,
} from './contrato.texto.js';

const VALIDADE_DIAS = 7;

const empresaSelect = {
  id: true,
  razao_social: true,
  cpf_cnpj: true,
  responsavel: true,
  email: true,
  telefone: true,
  cidade: true,
  estado: true,
  contrato_status: true,
  contrato_expira_em: true,
  contrato_aceito_em: true,
  contrato_aceito_nome: true,
  contrato_versao: true,
} as const;

const hashDoToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const escapar = (valor: string | null | undefined) =>
  (valor ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const urlDoContrato = (token: string) =>
  `${(process.env.APP_URL ?? 'https://fruitvale.com.br').replace(/\/$/, '')}/contrato/${token}`;

type EmpresaContrato = Prisma.empresasGetPayload<{
  select: typeof empresaSelect;
}>;

@Injectable()
export class ContratoService {
  private readonly logger = new Logger(ContratoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /**
   * Gera um novo link de aceite (invalida o anterior) e envia ao e-mail da
   * empresa. `enviado` é false se o SMTP está desligado ou falhou; o link
   * pode ser reenviado depois.
   */
  async emitir(empresaId: number) {
    const empresa = await this.prisma.empresas.findUnique({
      where: { id: empresaId },
      select: empresaSelect,
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    if (empresa.contrato_status === 'ACEITO')
      throw new ConflictException('O contrato dessa empresa já foi aceito.');
    if (!empresa.email)
      throw new BadRequestException(
        'A empresa não tem e-mail cadastrado para receber o contrato.',
      );

    const token = randomBytes(32).toString('base64url');
    const expira = new Date(Date.now() + VALIDADE_DIAS * 86_400_000);
    await this.prisma.empresas.update({
      where: { id: empresaId },
      data: {
        contrato_status: 'PENDENTE',
        contrato_token_hash: hashDoToken(token),
        contrato_enviado_em: new Date(),
        contrato_expira_em: expira,
      },
    });

    const link = urlDoContrato(token);
    const enviado = await this.email.enviar(
      this.montarEmail(empresa, link, expira),
    );
    if (!enviado && !this.email.ativo)
      this.logger.warn(
        `SMTP desligado: link do contrato da empresa ${empresaId}: ${link}`,
      );
    return { enviado, email: empresa.email, expira_em: expira };
  }

  /** Dados para a tela pública de aceite. */
  async consultar(token: string) {
    const empresa = await this.porToken(token);
    const aceito = empresa.contrato_status === 'ACEITO';
    if (
      !aceito &&
      empresa.contrato_expira_em &&
      empresa.contrato_expira_em < new Date()
    )
      throw new GoneException(
        'Este link expirou. Peça ao administrador para reenviar o contrato.',
      );

    return {
      status: empresa.contrato_status,
      aceito_em: empresa.contrato_aceito_em,
      aceito_por: empresa.contrato_aceito_nome,
      expira_em: empresa.contrato_expira_em,
      versao: aceito
        ? (empresa.contrato_versao ?? CONTRATO_VERSAO)
        : CONTRATO_VERSAO,
      contratada: contratada(),
      contratante: {
        razao_social: empresa.razao_social,
        cpf_cnpj: empresa.cpf_cnpj,
        responsavel: empresa.responsavel,
        email: empresa.email,
        telefone: empresa.telefone,
        cidade: empresa.cidade,
        estado: empresa.estado,
      },
      clausulas: clausulas(),
    };
  }

  async aceitar(token: string, nome: string, ip: string | null) {
    const empresa = await this.porToken(token);
    if (empresa.contrato_status === 'ACEITO')
      throw new ConflictException('Este contrato já foi aceito.');
    if (empresa.contrato_expira_em && empresa.contrato_expira_em < new Date())
      throw new GoneException(
        'Este link expirou. Peça ao administrador para reenviar o contrato.',
      );

    const agora = new Date();
    // condição no WHERE: dois cliques simultâneos só registram um aceite
    const { count } = await this.prisma.empresas.updateMany({
      where: {
        id: empresa.id,
        contrato_status: 'PENDENTE',
        contrato_token_hash: hashDoToken(token),
      },
      data: {
        contrato_status: 'ACEITO',
        contrato_aceito_em: agora,
        contrato_aceito_nome: nome,
        contrato_aceito_ip: ip,
        contrato_versao: CONTRATO_VERSAO,
        contrato_snapshot: {
          versao: CONTRATO_VERSAO,
          hash_texto: hashDoTexto(),
          contratada: { ...contratada() },
          contratante: {
            razao_social: empresa.razao_social,
            cpf_cnpj: empresa.cpf_cnpj,
            responsavel: empresa.responsavel,
            email: empresa.email,
            telefone: empresa.telefone,
            cidade: empresa.cidade,
            estado: empresa.estado,
          },
        },
      },
    });
    if (count === 0) throw new ConflictException('Este contrato já foi aceito.');
    return { status: 'ACEITO', aceito_em: agora };
  }

  private async porToken(token: string): Promise<EmpresaContrato> {
    const empresa =
      token.length >= 20
        ? await this.prisma.empresas.findUnique({
            where: { contrato_token_hash: hashDoToken(token) },
            select: empresaSelect,
          })
        : null;
    if (!empresa) throw new NotFoundException('Link de contrato inválido.');
    return empresa;
  }

  private montarEmail(empresa: EmpresaContrato, link: string, expira: Date) {
    const { nome } = contratada();
    const validade = expira.toLocaleDateString('pt-BR');
    const linhas: [string, string | null][] = [
      ['Empresa', empresa.razao_social],
      ['CPF/CNPJ', empresa.cpf_cnpj],
      ['Responsável', empresa.responsavel],
      ['E-mail', empresa.email],
      ['Telefone', empresa.telefone],
      [
        'Cidade/UF',
        [empresa.cidade, empresa.estado].filter(Boolean).join(' / ') || null,
      ],
    ];

    const tabela = linhas
      .map(
        ([rotulo, valor]) =>
          `<tr><td style="padding:6px 12px 6px 0;color:#6b6375">${rotulo}</td><td style="padding:6px 0;font-weight:600">${escapar(valor)}</td></tr>`,
      )
      .join('');

    const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f1f7;font-family:Arial,Helvetica,sans-serif;color:#2c2438">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#3a1d94;color:#fff;padding:20px 24px;border-radius:16px 16px 0 0"><strong style="font-size:20px">FruitVale</strong></div>
<div style="background:#fff;padding:24px;border-radius:0 0 16px 16px">
<h1 style="font-size:20px;margin:0 0 12px">Falta só aceitar o contrato</h1>
<p style="line-height:1.5">Olá! A empresa <strong>${escapar(empresa.razao_social)}</strong> foi cadastrada na plataforma FruitVale. Para liberar o acesso, leia o contrato de serviço e clique em aceitar.</p>
<p style="margin:16px 0 4px;font-weight:600">Dados cadastrados</p>
<table style="font-size:14px;border-collapse:collapse">${tabela}</table>
<p style="text-align:center;margin:28px 0"><a href="${escapar(link)}" style="background:#e0a83d;color:#2c1670;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;display:inline-block">Ler o contrato e aceitar</a></p>
<p style="font-size:13px;color:#6b6375;line-height:1.5">O link vale até <strong>${validade}</strong> e é de uso exclusivo da empresa. Se o botão não abrir, copie este endereço no navegador:<br><span style="word-break:break-all">${escapar(link)}</span></p>
<p style="font-size:13px;color:#6b6375;line-height:1.5">Se você não esperava este e-mail, pode ignorá-lo. Os dados acima estão incorretos? Avise ${escapar(nome)} antes de aceitar.</p>
</div></div></body></html>`;

    const texto = [
      `Falta só aceitar o contrato`,
      ``,
      `A empresa ${empresa.razao_social} foi cadastrada na plataforma FruitVale. Para liberar o acesso, leia o contrato e aceite no link abaixo.`,
      ``,
      ...linhas.map(([rotulo, valor]) => `${rotulo}: ${valor ?? '—'}`),
      ``,
      `Contrato: ${link}`,
      `O link vale até ${validade}.`,
    ].join('\n');

    return {
      para: empresa.email!,
      assunto: 'FruitVale: aceite o contrato para liberar o acesso',
      html,
      texto,
    };
  }
}
