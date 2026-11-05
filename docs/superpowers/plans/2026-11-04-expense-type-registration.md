# Cadastro de tipo de despesa

**Goal:** Oferecer `➕ CADASTRAR TIPO DESPESA` antes dos tipos de despesa do produto em todos os seletores correspondentes.

**Architecture:** Reutilizar financial_catalog_registration e o wizard supply_material_type_registration, que grava CADASTROTIPOMATERIAL com confirmação, validação de duplicidade e idempotência. Aplicar o novo TIPO à pergunta de origem, preservando campos, anexos, edição, provisões múltiplas e retornos aninhados. A classificação pessoal RECORRENTE/NÃO RECORRENTE não pertence a esse catálogo.

**Execution:** Execução direta autorizada pelo usuário, sem novas confirmações.

- [ ] Testar entrada, busca, página seguinte, vazio e seleção existente nos seletores de produto, lançamento e baixa.
- [ ] Estender reconhecimento do catálogo e retorno usando TIPO como label/value, sem aplicar filtros de PRODUTO ao registro de tipo.
- [ ] Atualizar menus persistidos antes da publicação e aceitar seus controles nas sessões já abertas.
- [ ] Testar cadastro confirmado, duplicado, cancelamento, retorno aninhado e preservação de anexos/valores/idempotência.
- [ ] Empacotar alteração reproduzível com hashes, conferir instalador, revisar e integrar PR.
- [ ] Publicar no servidor com lock, gate, backup e health; validar o módulo instalado. O backend comum disponibiliza a função em Android, iOS e Windows sem novo binário.
