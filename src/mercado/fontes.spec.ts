import { describe, expect, it } from 'vitest';
import {
  fruta,
  lerLinhaAtacado,
  lerLinhaComex,
  lerLinhaProdutor,
  normalizar,
  numero,
  produtoDaVariedade,
  somarAtacado,
} from './fontes.js';

// linhas copiadas dos arquivos reais da Conab (colunas com espaços de enchimento)
const ATACADO =
  '2024;8;SÃO PAULO-SP                            ;3550308                       ;SP;CEASA/PR - FOZ DO IGUACU                ;PR;FOZ DO IGUAÇU-PR        ;4108304 ;MANGA PALMER                  ;180;1080,0;Brasil';
const PRODUTOR =
  'UVA                      ;NÃO INFORMADO       ;350;RS        ;SUL            ;2026;9;PREÇO RECEBIDO P/ PRODUTOR                                  ;2,16';

describe('normalizar e fruta', () => {
  it('tira acento, espaço sobrando e põe em maiúsculas', () => {
    expect(normalizar('  Mamão   Formosa ')).toBe('MAMAO FORMOSA');
    expect(fruta('Uva de mesa')).toBe('UVA');
    expect(fruta('MANGA PALMER')).toBe('MANGA');
  });
});

describe('numero', () => {
  it('lê os formatos brasileiro e americano', () => {
    expect(numero('1080,0')).toBe(1080);
    expect(numero('1.234,56')).toBe(1234.56);
    expect(numero('5.8')).toBe(5.8);
    expect(numero('')).toBeNull();
    expect(numero('abc')).toBeNull();
  });
});

describe('lerLinhaAtacado', () => {
  it('interpreta a linha do PROHORT', () => {
    expect(lerLinhaAtacado(ATACADO)).toEqual({
      ano: 2024,
      mes: 8,
      produto: 'MANGA PALMER',
      ceasa: 'CEASA/PR - FOZ DO IGUACU',
      uf_ceasa: 'PR',
      municipio_origem: 'SÃO PAULO-SP',
      uf_origem: 'SP',
      quantidade_kg: 180,
      valor_rs: 1080,
    });
  });

  it('ignora o cabeçalho e linhas sem quantidade', () => {
    expect(
      lerLinhaAtacado(
        'id_ano_comercializacao;id_mes_comercializacao;municipio_origem_produto;a;b;c;d;e;f;dsc_produto;qtd;valor;pais',
      ),
    ).toBeNull();
    expect(lerLinhaAtacado(ATACADO.replace(';180;', ';0;'))).toBeNull();
  });
});

describe('lerLinhaProdutor', () => {
  it('lê o preço recebido pelo produtor', () => {
    expect(lerLinhaProdutor(PRODUTOR)).toEqual({
      ano: 2026,
      mes: 9,
      produto: 'UVA',
      classificacao: 'NAO INFORMADO',
      uf: 'RS',
      valor_kg: 2.16,
    });
  });

  it('descarta preço pago pelo produtor (insumos)', () => {
    expect(
      lerLinhaProdutor(
        PRODUTOR.replace(
          'PREÇO RECEBIDO P/ PRODUTOR',
          'PREÇO PAGO PELO PRODUTOR',
        ),
      ),
    ).toBeNull();
  });
});

describe('lerLinhaComex', () => {
  it('converte os números que chegam como texto', () => {
    expect(
      lerLinhaComex('08045020', {
        year: '2026',
        monthNumber: '3',
        country: 'Países Baixos (Holanda)',
        metricFOB: '1234567',
        metricKG: '890000',
      }),
    ).toEqual({
      ano: 2026,
      mes: 3,
      ncm: '08045020',
      pais: 'Países Baixos (Holanda)',
      valor_fob_usd: 1234567,
      peso_kg: 890000,
    });
  });

  it('descarta linha sem país ou mês', () => {
    expect(
      lerLinhaComex('1', { year: '2026', monthNumber: '13', country: 'X' }),
    ).toBeNull();
    expect(
      lerLinhaComex('1', {
        year: '2026',
        monthNumber: '1',
        metricFOB: '1',
        metricKG: '1',
      }),
    ).toBeNull();
  });
});

describe('somarAtacado', () => {
  it('soma linhas repetidas da mesma chave', () => {
    const l = lerLinhaAtacado(ATACADO)!;
    const [soma, ...resto] = somarAtacado([
      l,
      { ...l },
      { ...l, ceasa: 'OUTRA' },
    ]);
    expect(soma.quantidade_kg).toBe(360);
    expect(soma.valor_rs).toBe(2160);
    expect(resto).toHaveLength(1);
  });
});

describe('produtoDaVariedade', () => {
  const produtos = ['MANGA', 'MANGA ESPADA', 'MANGA PALMER', 'MANGA TOMMY'];
  it('acha a variedade abreviada pela Conab', () => {
    expect(produtoDaVariedade('MANGA', 'Tommy Atkins', produtos)).toBe(
      'MANGA TOMMY',
    );
    expect(produtoDaVariedade('MANGA', 'Palmer', produtos)).toBe(
      'MANGA PALMER',
    );
  });
  it('sem variedade ou sem correspondente: null (todas)', () => {
    expect(produtoDaVariedade('MANGA', null, produtos)).toBeNull();
    expect(produtoDaVariedade('MANGA', 'Kent', produtos)).toBeNull();
  });
});
