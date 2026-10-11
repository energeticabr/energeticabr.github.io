# Níveis de compactação de anexos

Patch incremental para `worker/compression.py`, `worker/workflow.py` e `channel_bridge.py`, preparado sobre os fontes inspecionados em produção em 11/10/2026.

| Nível | Teto decimal por arquivo | Redução mínima |
| --- | ---: | ---: |
| BAIXA (`low`) | 10.000.000 bytes | 25% |
| MÉDIA (`medium`) | 5.000.000 bytes | 50% |
| ALTA (`high`) | 1.000.000 bytes | 80% |
| MUITO ALTA (`very_high`) | 500.000 bytes | 90% |

O alvo é `min(teto, tamanho_real * (100 - redução) // 100)`. Os dois critérios são inclusivos. Metadados antigos não determinam o alvo. Todos os candidatos devem passar antes de gravar versões novas no repositório. Falhas preservam o original. Cada candidato é apresentado em uma prévia antes da escolha de versão; inclusive quando o original ultrapassa o limite de upload.

Imagens mantêm qualidade JPEG de pelo menos 65 e bordas de pelo menos 1600/800 px, salvo originais menores, que não são reduzidos em resolução. PDFs usam clonagem dos objetos, compressão de streams e recompressão dos pixels incorporados sem reduzir dimensões e sem rasterizar páginas. Texto extraível e anotações são validados após a geração. Transparências/máscaras ficam intactas. Arquivos com campos de assinatura ou evidência, links/texto `/assinaturas/` ou metadados de assinatura são recusados: alterar os bytes alteraria o hash da evidência. Estes critérios técnicos não garantem leitura universal; a prévia exige inspeção pelo usuário. Se ambos os limites não forem atingidos com resolução útil, a ação falha conservando o original.

`compress(attachments, max_total_bytes)` mantém o comportamento legado. A nova interface é `compress(attachments, max_total_bytes, level='low')`.

No portal, `attachment_compress` sem `level` cria o estado pendente `phase='level'` e devolve o menu `attachment_compression_level_low/medium/high/very_high`. `attachment_compression_choice` consome esse identificador e gera a prévia em `phase='preview'`. A escolha final mantém `attachment_compression_use_compressed/use_original`. É possível fornecer `level` explicitamente na ação inicial. No upload, a etapa existente `confirming_attachment_compression` guarda `awaiting_level`; o menu usa `compression_level_low/medium/high/very_high`. COMPACTAR TODOS escolhe um nível e transmite esse nível pela fila, sempre apresentando cada prévia. A alternativa antiga MAIS RESOLUÇÃO aparece somente para estados legados, pois não respeitava os limites dos quatro níveis.

## Verificação e instalação

```sh
COMPRESSION_BACKEND_SOURCE=/tmp/stagedworker python3 test_levels.py
python3 test_installer.py
python3 install.py /tmp/stagedworker --check
python3 install.py /tmp/stagedworker
```

Os testes usam `Pillow`, `pypdf` e `reportlab`. Ambos os testes podem usar um diretório plano configurado em `COMPRESSION_BACKEND_SOURCE`; sem essa variável usam os módulos locais em `work/compression-levels-backend`.

O instalador usa um diretório plano de preparação contendo os três fontes. Não aplique diretamente ao diretório `worker` em produção: `channel_bridge.py` reside na raiz da aplicação, e os outros dois módulos ficam em `worker/`. A implantação deve copiar os três arquivos para preparação, aplicar e testar o patch, criar um backup de produção e distribuir cada módulo ao seu caminho correto com validação de hashes.

O instalador verifica 43 âncoras exatas e a sintaxe de todos os módulos antes de qualquer gravação, cria um backup dos três fontes e restaura-os em caso de falha de gravação. Uma segunda execução valida os hashes do resultado antes de confirmar que já foi instalado. Divergências exigem revisão do patch, sem sobrescrever mudanças posteriores. Reiniciar o serviço e validar o portal são responsabilidades da implantação, fora deste instalador.
