// Seed: cadastra 20 empresas de plantação com contrato já ASSINADO.
// Idempotente: se o CNPJ já existir, atualiza os dados em vez de duplicar.
// Uso, dentro do container da API (ou local com DATABASE_URL definida):
//   node scripts/seed-empresas.mjs
import pg from 'pg';

// [razão social, responsável, telefone, estado, município, CNPJ (só dígitos)]
const empresas = [
  [
    'Agrícola Vale Verde Ltda',
    'Marcos Antônio Ribeiro',
    '(11) 98421-3307',
    'SP',
    'Ribeirão Preto',
    '44564380000162',
  ],
  [
    'Cafeicultores da Serra Azul',
    'Helena Cristina Duarte',
    '(35) 99172-4458',
    'MG',
    'Varginha',
    '23641867000121',
  ],
  [
    'Citricultores do Oeste Paulista',
    'Rogério Faria Mendes',
    '(17) 99634-2210',
    'SP',
    'Votuporanga',
    '50570044000125',
  ],
  [
    'Fruticultores do São Francisco',
    'Adriana Lopes Cavalcanti',
    '(87) 99853-7046',
    'PE',
    'Petrolina',
    '16404287000155',
  ],
  [
    'Agropecuária Terra Fértil',
    'João Batista Moreira',
    '(62) 98307-5519',
    'GO',
    'Rio Verde',
    '11774942000143',
  ],
  [
    'Produtores de Soja do Cerrado',
    'Fernanda Alves Teixeira',
    '(64) 99221-8863',
    'GO',
    'Jataí',
    '02038232000164',
  ],
  [
    'Cacauicultores do Sul da Bahia',
    'Carlos Eduardo Santana',
    '(73) 99148-6702',
    'BA',
    'Ilhéus',
    '28138113000177',
  ],
  [
    'Agrícola Campos Gerais',
    'Patrícia Welter Nogueira',
    '(42) 99915-3384',
    'PR',
    'Ponta Grossa',
    '00271847000100',
  ],
  [
    'Plantadores de Cana Usina Nova',
    'Ricardo Souza Pimentel',
    '(16) 99702-4175',
    'SP',
    'Sertãozinho',
    '15483161000150',
  ],
  [
    'Orizicultores do Vale do Itajaí',
    'Luciana Brandt Schmitt',
    '(47) 99688-2951',
    'SC',
    'Rio do Sul',
    '00276225000175',
  ],
  [
    'Agrícola Sol Nascente',
    'Antônio Carlos Pacheco',
    '(66) 99274-1860',
    'MT',
    'Sorriso',
    '09811654000170',
  ],
  [
    'Milho e Grãos do Planalto',
    'Débora Martins Ferraz',
    '(65) 99361-7724',
    'MT',
    'Lucas do Rio Verde',
    '08220101000180',
  ],
  [
    'Fruticultores do Vale do Açu',
    'Josefa Maria da Silva',
    '(84) 99556-9013',
    'RN',
    'Mossoró',
    '24303204000160',
  ],
  [
    'Produtores de Manga e Mamão de Linhares',
    'Eduardo Pinheiro Lacerda',
    '(27) 99743-2268',
    'ES',
    'Linhares',
    '03854323000130',
  ],
  [
    'Produtores de Uva Serra Gaúcha',
    'Giovana Zanella Bortolini',
    '(54) 99182-4437',
    'RS',
    'Bento Gonçalves',
    '78950011000120',
  ],
  [
    'Banana e Fruticultura do Vale do Ribeira',
    'Sérgio Takahashi Oliveira',
    '(13) 99617-8502',
    'SP',
    'Registro',
    '00489050000184',
  ],
  [
    'Produtores de Algodão do Oeste Baiano',
    'Mônica Rezende Barreto',
    '(77) 99829-3146',
    'BA',
    'Luís Eduardo Magalhães',
    '60444437000146',
  ],
  [
    'Agrícola Horizonte Verde',
    'Paulo Henrique Gontijo',
    '(34) 99478-5091',
    'MG',
    'Uberlândia',
    '02709449000159',
  ],
  [
    'Plantadores de Mandioca do Pará',
    'Raimunda Nazaré Corrêa',
    '(91) 99264-7835',
    'PA',
    'Castanhal',
    '34075739000184',
  ],
  [
    'Hortifrutigranjeiros Raízes da Terra',
    'Thiago Medeiros Camargo',
    '(41) 99703-6619',
    'PR',
    'Araucária',
    '33000167000101',
  ],
];

const AGORA = new Date();
const VERSAO = '1.0';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  let i = 0;
  for (const [razao, responsavel, telefone, estado, cidade, cnpj] of empresas) {
    i += 1;
    // e-mail do responsável: nome.sobrenome@dominio da empresa
    const [primeiro, ...resto] = responsavel
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(' ');
    const email = `${primeiro}.${resto[resto.length - 1]}@coop${String(i).padStart(2, '0')}.com.br`;

    await client.query(
      `INSERT INTO empresas
         (razao_social, cpf_cnpj, telefone, email, cidade, estado, responsavel,
          contrato_status, contrato_versao, contrato_enviado_em, contrato_aceito_em, contrato_aceito_nome)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEITO', $8, $9, $9, $7)
       ON CONFLICT (cpf_cnpj) DO UPDATE SET
         razao_social = EXCLUDED.razao_social,
         telefone = EXCLUDED.telefone,
         email = EXCLUDED.email,
         cidade = EXCLUDED.cidade,
         estado = EXCLUDED.estado,
         responsavel = EXCLUDED.responsavel,
         contrato_status = 'ACEITO',
         contrato_versao = EXCLUDED.contrato_versao,
         contrato_aceito_em = COALESCE(empresas.contrato_aceito_em, EXCLUDED.contrato_aceito_em),
         contrato_aceito_nome = COALESCE(empresas.contrato_aceito_nome, EXCLUDED.contrato_aceito_nome)`,
      [
        razao,
        cnpj,
        telefone,
        email,
        cidade,
        estado,
        responsavel,
        VERSAO,
        AGORA,
      ],
    );
  }
  await client.query('COMMIT');
  console.log(
    `[seed-empresas] ${empresas.length} empresas cadastradas/atualizadas com contrato ACEITO.`,
  );
} catch (erro) {
  await client.query('ROLLBACK');
  throw erro;
} finally {
  await client.end();
}
