# Galeria de notas fiscais SEFAZ

Em Suprimentos, o grupo de LANÇAMENTOS apresenta três galerias cinza, nesta ordem: PEDIDOS, LANÇAMENTOS e NOTAS FISCAIS SEFAZ. O botão azul existente preserva a ação `new_document`/`action_supply_launches` e ocupa a altura das três galerias. O grupo de provisões permanece independente.

## Leitura e origem

- Ação local: `action_notas_fiscais_sefaz_gallery`.
- Modelo: `notas_fiscais_sefaz`, em `src/chat/registration-gallery-data.js`.
- Lista: `NOTAS_FISCAIS_SEFAZ`, no site `company` (`/sites/energetica`).
- Transporte: SharePoint REST autenticado, com o escopo de leitura existente `https://energeticaltda.sharepoint.com/AllSites.Read`. Não requer endpoint novo para consultar a galeria.
- Na PWA, o retorno de consentimento Microsoft preserva e retoma a ação da galeria pela lista de ações permitidas de `src/web/browser-auth.js`.
- A fonte fiscal é exclusivamente SEFAZ. A interface não consulta SIEG, não cria notas e não executa importações ou manifestações.
- A leitura segue todas as páginas da lista antes de apresentar os registros, com a proteção de paginação existente. A ordenação inicial é emissão mais recente primeiro.

A coleta solicitada corresponde aos últimos três meses. A galeria informa que a cobertura ainda precisa de conferência; a presença de registros na lista não constitui prova de cobertura completa. Os filtros de emissão inicial/final permitem examinar os registros disponíveis sem impor um recorte adicional silencioso.

## Contrato de dados

| Campo da lista | Exibição |
| --- | --- |
| `Title` ou `FORNECEDOR` | Fornecedor |
| `CHAVE_ACESSO` | Chave preservada como texto, sem conversão numérica |
| `CNPJ_FORNECEDOR` | CNPJ fornecedor |
| `NUMERO_NOTA`, `SERIE` | Número e série |
| `DATA_EMISSAO` | Emissão, no formato brasileiro |
| `VALOR_TOTAL_NOTA`, `DESCONTOS`, `VALOR_LIQUIDO` | Moeda BRL |
| `ORIGEM_LIQUIDO` | Origem informada para o valor líquido |
| `SITUACAO`, `STATUS_IMPORTACAO`, `DIRECAO` | Estado real fornecido pela base |
| `XML_URL`, `ULTIMO_DOCUMENTO_URL`, `DANFE_URL` | Links dos arquivos realmente disponíveis |

Campos ausentes aparecem como **Pendente**. O aplicativo não presume desconto zero, não calcula líquido a partir de resumos e não cria DANFE fictício. Um zero presente na base continua aparecendo como `R$ 0,00`. A unicidade da chave e a conciliação dos documentos pertencem à base/coletor; a interface não deduplica registros para ocultar inconsistências.

Os links devem apontar diretamente para arquivos da biblioteca do site `company`, e podem ser texto HTTPS ou objetos SharePoint `{ Url, Description }`. O visualizador existente recebe uma função de download que faz `GET /_api/web/GetFileByServerRelativePath(...)/$value` com autenticação de leitura. A função rejeita outro host/site, credenciais embutidas e travessia de diretório antes de obter token. DANFE PDF usa a prévia existente; XML usa a abertura/salvamento do arquivo original já oferecidos pelo visualizador. Na ausência do visualizador, permanece o link HTTPS real como alternativa.

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

Os testes usam dados explicitamente fictícios. A fixture `tests/fixtures/notas-sefaz-responsive.html` mede a galeria e o menu em 320/390/768/1365 px e inclui o CSS compilado da PWA. Para gerar as duas capturas de 390 px, defina `NOTAS_SEFAZ_SCREENSHOT_DIR` para uma pasta existente antes de executar `tests/notas-sefaz-layout-browser.test.mjs`. O navegador do harness usa perfil temporário isolado, sem acessar a sessão do usuário.

A publicação e a validação com a primeira carga real são coordenadas separadamente. Testes com fixtures não demonstram recebimento real da SEFAZ nem cobertura completa da janela solicitada.
