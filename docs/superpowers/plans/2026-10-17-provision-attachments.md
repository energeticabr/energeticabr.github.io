# Provisão → descritivo: anexos

**Objetivo:** cada anexo confirmado em PROVISÃO PGTOS deve existir também no
DESCRITIVOPROVISAO referenciado pelo campo DESCRITIVOPROVISAO do filho.

**Decisão autorizada:** execução e publicação diretas conforme instrução do usuário.
Usar o servidor existente, não um novo fluxo Power Automate: o mesmo código pode
atender uploads do app e reconciliar uploads externos a cada dois minutos.

**Arquitetura:** encapsular o upload atual em `SharePointClient.ensure_attachment`
e acrescentar a sincronização após confirmar o arquivo original. Um módulo
`worker/provision_attachment_sync.py` fará a cópia, a conferência SHA-256, os
nomes estáveis em caso de colisão e a reconciliação periódica. Um timer systemd
executará o módulo com o usuário e as credenciais já usados pelo app.

**Restrições:** não alterar valores/status/datas; não apagar anexos; não inventar
vínculos ausentes; nunca substituir arquivos diferentes; nenhuma mensagem para
terceiros. Preservar anexos originais, inclusive quando a cópia falhar. Não
transformar falhas de consulta em listas vazias. Cache é otimização, não prova:
metadados/nomes/versionamento são reconsultados e há reconferência horária.

## Implementação e verificação

- [x] Capturar baseline atual e escrever testes falhando para cópia, duplicidade,
  nomes conflitantes, repetição após resposta perdida, vínculo inválido/trocado,
  erro de leitura, seleção por lista e reconciliação de upload externo.
- [x] Implementar o módulo isolado e o hook no cliente. A confirmação só ocorre
  depois da leitura e comparação do conteúdo no pai. Serializar por pai entre
  processos. Validar versões/vínculos antes e após a cópia.
- [x] Implementar varredura paginada com escopo restrito e cache atômico; falhas
  individuais permanecem pendentes para a próxima execução. Sem vínculo, manter
  o original e registrar o caso sem criar um pai arbitrário.
- [x] Revisão independente, testes focados e regressão de anexos/provisões.
- [x] Implantar com hashes, backups e rollback. Instalar timer com sandbox e
  diretório gravável dedicado. Verificar os serviços e executar reconciliação
  inicial das provisões já vinculadas.
- [x] Conferir arquivos e hashes reais no descritivo 23 e idempotência de segunda
  execução; conferir anexos visíveis no app. Publicar o pacote no repositório.

## Riscos que os testes devem cobrir

- Resposta perdida após upload: repetição não duplica.
- Mesmo nome em dois filhos: preservar ambos os conteúdos.
- Vínculo alterado durante cópia: interromper e retomar no destino atual.
- Arquivo novo sem mudança percebida no cache: comparar nomes e revalidar conteúdo.
- Sem anexo ou vínculo histórico: não fabricar arquivos ou relações.

## Registro

- Investigação: criação/baixa agrupada já podem anexar ao pai; upload posterior ao
  filho usa apenas `ensure_attachment`, sem propagação. Confirmado por consulta
  somente leitura: filho com dois arquivos, pai vinculado sem arquivos.
