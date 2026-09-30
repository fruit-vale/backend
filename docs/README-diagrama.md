# Diagrama entidade-relacionamento

- `diagrama-er.mmd` — fonte do diagrama (Mermaid `erDiagram`), escrita a partir de `prisma/schema.prisma`.
- `diagrama-er.png` / `diagrama-er.pdf` — versões renderizadas (layout ELK).

Cardinalidade: `||` exatamente um · `|o` zero ou um (chave estrangeira opcional) · `o{` zero ou muitos.

## Atualizar depois de mudar o banco

1. Ajuste `diagrama-er.mmd` conforme o `schema.prisma` (tabelas, colunas e relações).
2. Renderize com o Mermaid CLI, usando o layout ELK:

   ```bash
   npx -p @mermaid-js/mermaid-cli -p @mermaid-js/layout-elk mmdc \
     -i docs/diagrama-er.mmd -o docs/diagrama-er.pdf --pdfFit \
     -c <(echo '{"layout":"elk"}')
   npx -p @mermaid-js/mermaid-cli -p @mermaid-js/layout-elk mmdc \
     -i docs/diagrama-er.mmd -o docs/diagrama-er.png -s 2 \
     -c <(echo '{"layout":"elk"}')
   ```

   Sem instalar nada: cole o conteúdo de `diagrama-er.mmd` em https://mermaid.live e exporte PNG/SVG.
