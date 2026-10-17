# Anexos da provisão no descritivo vinculado

Um anexo enviado depois da criação de PROVISÃO PGTOS ficava apenas na provisão.
O cliente agora confirma o original e copia seu conteúdo para o item de
DESCRITIVOPROVISAO indicado no vínculo. O mesmo módulo reconcilia anexos
adicionados diretamente pelo SharePoint a cada dois minutos.

## Comportamento

- Compara conteúdo SHA-256, inclusive quando um arquivo idêntico tem outro nome.
- Preserva originais e arquivos diferentes; não apaga ou sobrescreve anexos.
- Cópias recebem prefixo de provisão e hash completo. Caracteres especiais são
  normalizados somente no nome da cópia, para compatibilidade do upload legado.
- Serializa cópias por descritivo e revalida vínculo/versão antes e depois.
- Falhas parciais são tentadas novamente. Provisões sem vínculo são preservadas
  sem inventar um descritivo. Valores, status e datas financeiras não são editados.
- Confere metadados/nomes a cada execução e reconfere hashes a cada hora; cache
  atômico em `/var/lib/energetica-whatsapp/provision-attachment-sync`.

Não depende de Power Automate. A mudança no servidor atende os clientes Android,
iOS e Windows, sem exigir publicação de novos pacotes nativos.

## Validação

- 22 testes focados passaram no Python 3.9 do runtime candidato. Incluem
  concorrência, repetição após resposta perdida, colisões de nomes, vínculo
  alterado, conteúdo corrompido, paginação, cache e hook real do cliente.
- Teste do adapter e de Requests reproduziu falhas com `#`, `%` e `?` antes da
  correção e passou depois. Revisão independente não apontou outro bloqueio.
- Regressão das consultas e baixas: 106 passed, 1 deselected. A expectativa
  histórica desmarcada já foi substituída no pacote provision-search-missing-values.
- Dry-run real: 15 provisões vinculadas com anexos, 9 cópias necessárias,
  12 conteúdos já presentes, zero erros.

## Publicação verificada

Código publicado em produção e espelho em 2026-10-17 às 04:21:05 UTC, com hashes
conferidos, backup e rollback. Bridge retornou `/health` com `status: ok`.
Backup: `/var/backups/energetica-whatsapp/provision-attachments-20261017T042105407761Z`.

Primeira execução do serviço, encerrada às 04:21:49 UTC: **9 cópias**, 12 conteúdos
reutilizados, zero erros. A execução automática às 04:22:00 UTC terminou com
zero novas cópias e zero erros. Timer e serviços do app/WhatsApp ativos.

Leitura independente confirmou os dois arquivos da provisão 337 no descritivo
23, com os mesmos tamanhos e SHA-256. As 107 provisões históricas com anexos e
sem vínculo foram preservadas; passam a ser elegíveis quando houver um vínculo.

## Instalação reproduzível

O manifesto fixa baseline, código candidato e bundle privado. `source.patch`
contém somente a alteração de código; o bundle com os arquivos completos fica
fora do repositório. Stage privado: `/home/opc/provision-attachments-20261017`.
O runner compartilhado vem de `../launch-payroll-per-payment/deploy.py` em LF.

1. Preparar bundle, manifesto, runner, instaladores e unidades no stage.
2. Executar `deploy.py --check <sha256-do-manifesto>` e, depois,
   `deploy.py --deploy <sha256-do-manifesto>` no Python do backend com sudo.
3. Executar `install_timer.py <sha256-do-manifesto> <sha256-service> <sha256-timer>`.
   O instalador valida código/unidades, executa uma reconciliação e só então
   habilita o timer. Unidades preexistentes divergentes são preservadas.

Para suspender a reconciliação, desabilitar o timer com `systemctl disable --now
energetica-provision-attachments.timer`; isso não remove arquivos já copiados.
O hook do app é revertido restaurando os arquivos do backup correspondente.
