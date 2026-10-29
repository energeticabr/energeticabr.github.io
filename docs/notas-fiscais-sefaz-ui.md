# Galeria de notas fiscais SEFAZ

Em Suprimentos, o grupo de LANÇAMENTOS apresenta três galerias cinza, nesta ordem: PEDIDOS, LANÇAMENTOS e NOTAS FISCAIS SEFAZ. O botão azul existente preserva a ação `new_document`/`action_supply_launches` e ocupa a altura das três galerias. O grupo de provisões permanece independente.

## Leitura e origem

- Ação local: `action_notas_fiscais_sefaz_gallery`.
- Modelo: `notas_fiscais_sefaz`, em `src/chat/registration-gallery-data.js`.
- Lista: `NOTAS_FISCAIS_SEFAZ`, no site `company` (`/sites/energetica`).
- Transporte: SharePoint REST autenticado, com o escopo de leitura existente `https://energeticaltda.sharepoint.com/AllSites.Read`. Não requer endpoint novo para consultar a galeria.
- Na PWA, o retorno de consentimento Microsoft preserva e retoma a ação da galeria pela lista de ações permitidas de `src/web/browser-auth.js`.
- As fontes identificadas são SEFAZ para NF-e/CT-e e ADN nacional para NFS-e. Os três tipos permanecem na mesma galeria, com badge e filtro por tipo. O fallback de registros legados usa modelo 55 para NF-e e 57/67 para CT-e; tipo desconhecido aparece como pendente. A interface não consulta SIEG, não cria notas e não executa importações ou manifestações.
- A leitura segue todas as páginas da lista antes de apresentar os registros, com a proteção de paginação existente. A ordenação inicial é emissão mais recente primeiro.

A coleta está configurada desde 01/10/2026, mantendo a continuidade nos meses seguintes. A galeria informa que a cobertura ainda precisa de conferência; a presença de registros na lista não constitui prova de cobertura completa. Os filtros de emissão inicial/final permitem examinar os registros disponíveis sem impor um recorte adicional silencioso.

## Destaque de retenção pelo comprador

NF-e de entrada autorizada com XML completo e `STATUS_RETENCOES=RETENCAO_INFORMADA_XML` recebe fundo vermelho claro, borda vermelha e aviso visível quando existir valor positivo em `PIS_RETIDO`, `COFINS_RETIDA`, `CSLL_RETIDA`, `IRRF_RETIDO`, `INSS_RETIDO` ou `ISS_RETIDO`. Para CT-e e NFS-e, exige também o token exato `TOMADOR` em `PAPEL_EMPRESA`, que pode conter papéis separados por `;`. Terceiro, intermediário, prestador ou papel ausente não recebem o destaque; `NAO_TOMADOR` não é aceito como tomador. Os valores aparecem em Tributos e encargos e a soma no aviso. O PDF permanece à esquerda e o líquido não é alterado. Saída, cancelada, resumo, zero e tributos gerais não acionam o destaque. Ausência desses valores significa “Não informada no XML”, sem concluir dispensa legal. A origem de cada campo e a implantação estão descritas em `backend-patches/notas-fiscais-sefaz-retencoes/docs/RETENCOES.md`.

## Contrato de dados

| Campo da lista | Exibição |
| --- | --- |
| `Title` ou `FORNECEDOR` | Fornecedor |
| `TIPO_FISCAL`, `ORIGEM_FISCAL` | NF-e / CT-e / NFS-e e origem real registrada |
| `TOMADOR`, `CNPJ_TOMADOR`, `PAPEL_EMPRESA` | Grupo Operação/Serviço e tomador para CT-e e NFS-e |
| `DESCRICAO_SERVICO`, `MUNICIPIO_PRESTACAO`, `CODIGO_SERVICO`, `VALOR_SERVICOS` | Grupo Serviço e tomador para NFS-e; descrição integral com quebras preservadas |
| `ISS` | Tributos e encargos da NFS-e |
| `CHAVE_ACESSO` | Chave preservada como texto, sem conversão numérica; botão copia os 44 caracteres de NF-e/CT-e e os 50 dígitos da NFS-e por inteiro |
| `CNPJ_FORNECEDOR` | CNPJ fornecedor |
| `NUMERO_NOTA`, `SERIE` | Número e série |
| `DATA_EMISSAO` | Emissão, no formato brasileiro |
| `VALOR_TOTAL_NOTA`, `DESCONTOS`, `VALOR_LIQUIDO` | Moeda BRL |
| `ORIGEM_LIQUIDO` | Origem informada para o valor líquido |
| `SITUACAO`, `STATUS_IMPORTACAO`, `DIRECAO` | Estado real fornecido pela base |
| `XML_URL`, `ULTIMO_DOCUMENTO_URL`, `DANFE_URL` | Links dos arquivos realmente disponíveis |

Campos ausentes aparecem como **Pendente**. O aplicativo não presume desconto zero, não calcula líquido a partir de resumos e não cria DANFE fictício. Um zero presente na base continua aparecendo como `R$ 0,00`. A unicidade da chave e a conciliação dos documentos pertencem à base/coletor; a interface não deduplica registros para ocultar inconsistências.

Os links devem apontar diretamente para arquivos da biblioteca do site `company`, e podem ser texto HTTPS ou objetos SharePoint `{ Url, Description }`. O visualizador existente recebe uma função de download que faz `GET /_api/web/GetFileByServerRelativePath(...)/$value` com autenticação de leitura. A função rejeita outro host/site, credenciais embutidas e travessia de diretório antes de obter token. O ícone PDF à esquerda da própria linha usa o rótulo e o nome acessível DANFE (NF-e), DACTE (CT-e) ou DANFSe (NFS-e), sempre abrindo o URL daquele registro. O campo de armazenamento continua `DANFE_URL`. Os três PDFs usam a prévia existente; XML usa a abertura/salvamento do arquivo original já oferecidos pelo visualizador. Na ausência do visualizador, permanece o link HTTPS real como alternativa.

## Verificação local

```powershell
cd apps/energetico-mobile
pnpm guard:signature-gestures
node --test tests/notas-sefaz-gallery.test.mjs tests/notas-sefaz-layout-browser.test.mjs
node --test --test-name-pattern='NF-e SEFAZ opens locally' tests/app-controller.test.mjs
node --test tests/browser-auth.test.mjs
pnpm test
pnpm build
pnpm build:pwa
pnpm guard:signature-gestures
```

Os testes usam dados explicitamente fictícios. A fixture `tests/fixtures/notas-sefaz-responsive.html` mede a galeria e o menu em 320/390/768/1365 px e inclui o CSS compilado da PWA. O parâmetro `unified` inclui NF-e, CT-e, NFS-e tomadora, NFS-e de terceiros e resumo pendente, todos fictícios. Para gerar capturas de 320 e 390 px, defina `NOTAS_SEFAZ_SCREENSHOT_DIR` para uma pasta existente antes de executar `tests/notas-sefaz-layout-browser.test.mjs`. O navegador do harness usa perfil temporário isolado, sem acessar a sessão do usuário.

A publicação e a validação com a primeira carga real são coordenadas separadamente. Testes com fixtures não demonstram recebimento real da SEFAZ nem cobertura completa da janela solicitada.
