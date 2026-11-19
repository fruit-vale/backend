import { createHash } from 'node:crypto';

/** Versão do texto. Mude ao alterar qualquer cláusula: o aceite registra a versão. */
export const CONTRATO_VERSAO = '1.0';

export interface Clausula {
  titulo: string;
  paragrafos?: string[];
  itens?: string[];
}

export interface Contratada {
  nome: string;
  cnpj: string | null;
}

export function contratada(): Contratada {
  return {
    nome: process.env.CONTRATADA_NOME ?? 'FruitVale',
    cnpj: process.env.CONTRATADA_CNPJ ?? null,
  };
}

/** Cláusulas do contrato de adesão ao serviço FruitVale. */
export function clausulas(): Clausula[] {
  const { nome } = contratada();
  return [
    {
      titulo: '1. Objeto',
      paragrafos: [
        `Este contrato regula a prestação, pela CONTRATADA (${nome}), do serviço de monitoramento e apoio à decisão para fruticultura por meio da plataforma FruitVale, à CONTRATANTE identificada acima, mediante licença de uso, sem transferência de propriedade do software.`,
      ],
    },
    {
      titulo: '2. Serviços incluídos',
      itens: [
        'Cadastro de propriedades, lotes, culturas e ciclos de cultivo, com mapa e imagem de satélite.',
        'Recebimento e armazenamento das leituras dos sensores da CONTRATANTE (temperatura, umidade, solo, precipitação e outras).',
        'Alertas quando uma medida sai da faixa ideal da cultura.',
        'Previsão de colheita, ajustada pela temperatura medida.',
        'Consulta de preços de mercado e dados de exportação.',
        'Análises e relatórios em PDF e CSV.',
        'Gestão de usuários da empresa, com perfis de administrador, produtor e analista.',
      ],
    },
    {
      titulo: '3. Obrigações da CONTRATADA',
      itens: [
        'Manter a plataforma disponível com esforço razoável, ressalvadas manutenções, falhas de internet, de energia e de terceiros.',
        'Proteger os dados da CONTRATANTE com controle de acesso por perfil, separação por empresa, senhas criptografadas e conexões protegidas por TLS.',
        'Prestar suporte pelo canal informado na contratação.',
        'Avisar mudanças relevantes neste contrato ou nos Termos de Uso.',
      ],
    },
    {
      titulo: '4. Obrigações da CONTRATANTE',
      itens: [
        'Informar dados verdadeiros e mantê-los atualizados.',
        'Guardar com sigilo o login e a senha de seus usuários e responder pelo uso deles.',
        'Instalar, manter e calibrar os próprios sensores e a conexão de internet, seguindo as orientações da plataforma.',
        'Usar a plataforma apenas para fins lícitos, sem tentar acessar dados de outras empresas, burlar limites de segurança ou revender o serviço.',
        'Cadastrar apenas usuários autorizados e desativar quem deixar de ter vínculo com a empresa.',
      ],
    },
    {
      titulo: '5. Equipamentos e sensores',
      paragrafos: [
        'Os sensores, microcontroladores e a conexão de internet usados para enviar leituras são de responsabilidade da CONTRATANTE, salvo ajuste diferente por escrito. A CONTRATADA fornece as credenciais e o guia de conexão, mas não garante o funcionamento de equipamentos de terceiros.',
      ],
    },
    {
      titulo: '6. Preço e pagamento',
      paragrafos: [
        'Valores, periodicidade e forma de pagamento são os da proposta comercial acordada entre as partes e fazem parte deste contrato. O atraso pode levar à suspensão do acesso, após aviso prévio.',
      ],
    },
    {
      titulo: '7. Previsões, alertas e preços',
      paragrafos: [
        'Previsões de colheita, alertas e preços são estimativas calculadas a partir de modelos, das leituras dos sensores e de fontes públicas. Servem de apoio e não substituem a avaliação da CONTRATANTE. A CONTRATADA não garante resultado de safra, preço de venda nem ausência de perdas, e a decisão final de manejo, colheita e venda é sempre da CONTRATANTE.',
      ],
    },
    {
      titulo: '8. Dados e proteção de dados pessoais (LGPD)',
      itens: [
        'Os dados inseridos pela CONTRATANTE (propriedades, lotes, leituras e relatórios) continuam sendo dela. Ela autoriza a CONTRATADA a tratá-los apenas para prestar o serviço.',
        'No tratamento de dados pessoais de usuários e de contatos, as partes cumprem a Lei nº 13.709/2018 (LGPD), conforme a Política de Privacidade da plataforma, disponível em /termos.',
        'A CONTRATADA não vende dados nem os usa para publicidade, e só os compartilha com operadores de infraestrutura, provedores de mapas e autoridades, nos casos descritos na Política de Privacidade.',
        'A CONTRATANTE declara ter base legal para inserir na plataforma os dados pessoais de seus colaboradores e contatos.',
        'Em caso de incidente de segurança que possa causar risco ou dano relevante, a CONTRATADA comunicará a CONTRATANTE e a ANPD, nos termos da lei.',
      ],
    },
    {
      titulo: '9. Propriedade intelectual',
      paragrafos: [
        'O software, a marca, o layout e os modelos da plataforma pertencem à CONTRATADA. Este contrato concede à CONTRATANTE apenas o direito de uso, não exclusivo e intransferível, durante a vigência.',
      ],
    },
    {
      titulo: '10. Limitação de responsabilidade',
      paragrafos: [
        'A CONTRATADA não responde por danos indiretos, lucros cessantes nem por perdas decorrentes de decisões tomadas com base nas informações exibidas, salvo nos casos em que a lei determinar o contrário. Em qualquer hipótese, a responsabilidade total fica limitada ao valor pago pela CONTRATANTE nos doze meses anteriores ao evento, quando a lei permitir.',
      ],
    },
    {
      titulo: '11. Vigência e rescisão',
      paragrafos: [
        'O contrato vale a partir do aceite eletrônico, por prazo indeterminado, e pode ser encerrado por qualquer das partes mediante aviso prévio de 30 dias. A CONTRATADA pode suspender ou encerrar o acesso de imediato em caso de descumprimento grave, fraude ou risco à segurança.',
        'Encerrado o contrato, a CONTRATANTE pode pedir a exportação dos seus dados, e a CONTRATADA os eliminará ou anonimizará nos prazos da Política de Privacidade, ressalvadas as obrigações legais de guarda.',
      ],
    },
    {
      titulo: '12. Aceite eletrônico',
      paragrafos: [
        'O aceite é dado pelo responsável da CONTRATANTE, no link enviado ao e-mail cadastrado, e tem valor de manifestação de vontade e de assinatura eletrônica. A CONTRATADA registra a data e a hora, o nome informado, o endereço IP e a versão do contrato aceita. O acesso à plataforma só é liberado depois do aceite.',
      ],
    },
    {
      titulo: '13. Foro',
      paragrafos: [
        'Aplica-se a legislação brasileira. Fica eleito o foro da comarca da sede da CONTRATADA para resolver controvérsias deste contrato, ressalvado o foro do consumidor, quando aplicável.',
      ],
    },
  ];
}

/** Impressão digital do texto aceito, guardada junto do aceite. */
export function hashDoTexto() {
  return createHash('sha256')
    .update(JSON.stringify({ v: CONTRATO_VERSAO, c: clausulas() }))
    .digest('hex');
}
