# Retenções pelo comprador na galeria SEFAZ

O cartão de uma NF-e de entrada autorizada recebe fundo vermelho claro, borda vermelha e aviso “Retenção pelo comprador” quando o XML completo informa um valor positivo de retenção. O aviso apresenta a soma desses valores e seus tributos. O líquido da nota permanece o valor original, sem nova dedução.

| Campo SharePoint | Origem do valor no XML |
|---|---|
| `PIS_RETIDO` | `infNFe/total/retTrib/vRetPIS` |
| `COFINS_RETIDA` | `infNFe/total/retTrib/vRetCOFINS` |
| `CSLL_RETIDA` | `infNFe/total/retTrib/vRetCSLL` |
| `IRRF_RETIDO` | `infNFe/total/retTrib/vIRRF` |
| `INSS_RETIDO` | `infNFe/total/retTrib/vRetPrev` |
| `ISS_RETIDO` | `infNFe/total/ISSQNtot/vISSRet` |

`STATUS_RETENCOES` registra `RETENCAO_INFORMADA_XML` ou `NAO_INFORMADA_XML`. Campo opcional ausente permanece nulo; zero explícito permanece zero. Resumos/eventos preservam o estado do XML completo e não criam uma análise nova. Reanálise de XML completo limpa valores opcionais anteriores ausentes. O estado “Não informada no XML” não comprova dispensa de retenção pela legislação: a aplicação exibe dados do documento e não calcula enquadramentos tributários a partir do fornecedor ou das observações.

Valores gerais de ICMS, ICMS-ST, PIS, COFINS, tributos aproximados, bases de cálculo, descontos ou diferença entre total e líquido não acionam o destaque. Notas de saída, de terceiros, canceladas ou sem XML completo também não recebem o aviso ativo.

O modelo e os campos seguem o [MOC 7.0, grupos W01 e W02, páginas 59–60](https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-i-leiaute-e-rv.pdf). O escopo operacional continua sendo NF-e modelo 55; esta alteração não implanta outros modelos de documentos.

## Implantação

Gerar os fluxos com `node scripts/build-flows.mjs`, `node scripts/build-live-flows.mjs` e `node scripts/build-retention-flow.mjs`. `Deploy-RetentionMetadata.ps1` utiliza exclusivamente as conexões Microsoft existentes. Os modos `Provision`, `Prepare`, `Read`, `Backfill` e `Verify` separam criação/verificação de colunas, atualização do receptor, leitura e gravação dos metadados. `UpdateHelper` permite atualizar a fonte do fluxo auxiliar sem criar outro. Executar a etapa seguinte somente após confirmar o resultado anterior.

O fluxo auxiliar `06` atualiza apenas os sete campos acima, por chave única de registro já existente e ETag. Não cria notas, não grava arquivos, não modifica valores totais/líquidos e não dispara WhatsApp. O script analisa os XMLs autorizados já arquivados, sem consultar novamente a SEFAZ. Evidência agregada: `evidence/retencoes-live.json`.

`Install-RetentionRuntime.ps1` instala somente `Sefaz.psm1` no coletor nativo, espera os trabalhadores ficarem ociosos, confere o hash e executa um teste fictício de extração. Preserva cursor, configuração, corte de emissão e horários; reativa somente as tarefas previamente habilitadas. Se a validação falhar, restaura o módulo anterior. Comprovante nativo: `C:/Users/Public/Documents/Energetica-SEFAZ-Retencoes.json`.
