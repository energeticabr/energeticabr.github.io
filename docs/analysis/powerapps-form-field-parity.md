# Paridade de campos de formulário: Power Apps x portal administrativo

> Escopo exclusivamente analítico. Nenhum arquivo compartilhado do portal ou do unpack foi alterado. O inventário foi obtido do unpack atual e comparado com o contrato e o renderizador dinâmico indicados abaixo.

## Fontes examinadas

- Unpack Power Apps: `D:\CodexData\_tmp\powerapps-ui-inventory-20260826-1501\ENERGETICA-current\Src`.
- Contrato do portal: `D:\CodexData\portal-admin-microsoft\portal\catalog\powerapps-ui-contract.js`.
- Formulário dinâmico efetivo: `D:\CodexData\portal-admin-microsoft\portal\ui\dynamic-form.js` (não existe `portal/forms/dynamic-form.js` neste worktree).
- Conversão de metadados e validação: `D:\CodexData\portal-admin-microsoft\portal\data\column-mapper.js`.
- Catálogo de entidades: `D:\CodexData\portal-admin-microsoft\portal\catalog\entities.js`.

## Método e limites

- Foram lidos 183 formulários, dos quais 179 aparecem em `SubmitForm`, além de 74 chamadas `Patch`, em 68 fontes operacionais.
- Campo visível = DataCard sem `Visible` restritivo ou explicitamente verdadeiro. Campo condicional/oculto = DataCard cujo `Visible` depende de fórmula ou é falso.
- Campo calculado = `Update` que não é leitura direta e simples do controle; inclui constantes, variáveis, `LookUp`, `If`, `Concat`, IDs derivados e fórmulas compostas.
- A análise é estática. Fórmulas montadas em strings, coleções intermediárias e fluxos externos podem exigir validação funcional adicional no Power Apps/SharePoint.

## Conclusão executiva

- O portal só possui contrato de campos realmente explícito para **LANCAMENTOS**. As demais entidades usam, em regra, o curinga `*`, que exibe todo campo SharePoint editável e não técnico, e não a tela desenhada no Power Apps.
- Há 32 campos com visibilidade condicional/oculta, 45 campos calculados/forçados e 12 campos que agregam múltiplas seleções. Essas regras não estão representadas no contrato atual.
- Foram encontrados 710 controles fechados nas diferentes ocorrências de formulário. 293 campos únicos dependem de `Items` literal, filtrado ou de outra lista; 178 campos únicos definem `SearchFields/IsSearchable`. O portal atual não interpreta essas fórmulas.
- `dynamic-form.js` suporta Choice nativo do SharePoint, checkbox, número, data, texto e lookup/person **simples** obtido dos metadados. Não reproduz `Distinct/Filter/AddColumns/SortByColumns`, listas literais fora do metadata, dependências entre campos, `Update` calculado, ComboBox múltiplo ou validações Power Fx específicas.
- A lacuna de maior risco é de integridade, não apenas visual: defaults como status, aprovações, IDs vinculados, campos de auditoria e valores derivados podem deixar de ser gravados ou ficar editáveis sem a lógica original.

## Maiores lacunas por prioridade

| Lista | Entidade | Campos | Cond./ocultos | Calculados | Items externos/literais | Múltiplos | Prioridade |
|---|---|---:|---:|---:|---:|---:|---:|
| IMOVEL CADASTRADO | imoveis | 23 | 0 | 11 | 11 | 9 | 91 |
| FORNECEDORES | fornecedores | 25 | 10 | 2 | 14 | 1 | 68 |
| EMPREITEIRO | empreiteiros | 29 | 2 | 10 | 8 | 0 | 52 |
| DESCRITIVOPRESENCA | descricoes-de-presenca | 23 | 5 | 1 | 14 | 0 | 46 |
| LANCAMENTOS | lancamentos | 28 | 4 | 5 | 8 | 0 | 43 |
| LINHASMEDICAO | linhas-de-medicao | 21 | 3 | 2 | 12 | 0 | 39 |
| DOCUMENTOS_1 | documentos-operacionais | 15 | 2 | 0 | 10 | 0 | 26 |
| NOVACOTACAO | novas-cotacoes | 10 | 0 | 2 | 6 | 2 | 26 |
| PROVISÃO PGTOS | provisoes-de-pagamento | 18 | 0 | 3 | 8 | 0 | 25 |
| LANÇAMENTORECEITA | receitas | 17 | 1 | 1 | 9 | 0 | 24 |
| DESPESASRECORRENTES | despesas-recorrentes | 18 | 1 | 1 | 8 | 0 | 22 |
| APONTAMENTOSFUNCIONARIOS | apontamentos-de-funcionarios | 12 | 1 | 0 | 9 | 0 | 21 |
| LANCAMENTOTAREFAS | lancamentos-de-tarefas | 21 | 0 | 1 | 9 | 0 | 21 |
| DESCRICAOMEDICOES | descricoes-de-medicao | 20 | 0 | 1 | 8 | 0 | 19 |
| TAREFASDELEGADAS | tarefas-delegadas | 15 | 0 | 1 | 8 | 0 | 19 |
| TAREFASRECORRENTES | tarefas-recorrentes | 12 | 0 | 1 | 8 | 0 | 19 |
| CADASTRO ALUGUEL | cadastros-de-aluguel | 14 | 1 | 0 | 7 | 0 | 17 |
| IMOBILIZADOS | imobilizados | 18 | 0 | 0 | 8 | 0 | 16 |
| LINHACONTRATO | linhas-de-contrato | 13 | 0 | 0 | 8 | 0 | 16 |
| LANCAMENTOCOMPRAS | compras | 14 | 1 | 0 | 6 | 0 | 15 |

## LANCAMENTOS: análise detalhada

**Telas/formulários:** `EDITARLANCAMENTO` em `E1- EDITAR LANÇAMENTO COMPRA.pa.yaml`; `FORMULÁRIO LANÇAMENTO` em `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `Form7` em `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`; `Form5_1` em `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`.
**Contrato do portal:** explícito (27 declarações de campo).
**Campos usados pelo Power Apps e ausentes da lista explícita do contrato:** **ACUMULADO**, **ADIANTAMENTO**, **APROVACAO**, **ASSINATURA**, **CONTRATO**, **GERADESEMBOLSO**, **MEDICAOPARCIAL**, **NOTA**, **OBSERVAÇÕES ENTREGA** (`OBSERVA_x00c7__x00d5_ESENTREGA`), **UN**.

### Composição dos formulários

| Formulário | Arquivo | Campos | Observação |
|---|---|---:|---|
| `EDITARLANCAMENTO` | `E1- EDITAR LANÇAMENTO COMPRA.pa.yaml` | 24 | cadastro/edição principal |
| `FORMULÁRIO LANÇAMENTO` | `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml` | 27 | cadastro/edição principal |
| `Form7` | `G1- HISTÓRICO LANÇAMENTOS.pa.yaml` | 1 | formulário auxiliar |
| `Form5_1` | `G1- HISTÓRICO LANÇAMENTOS.pa.yaml` | 1 | formulário auxiliar de anexos |

### Campos condicionais ou calculados

| Campo | Tipo | Fórmula relevante |
|---|---|---|
| **AGRUPAR** | calculado | `Update: If(Checkbox18.Value, DataCardValue248_1.Text, varUltimoIDNotasPendentes )` |
| **Anexos** (`{Attachments}`) | conditional | `Visible: arquivos` |
| **APROVACAO** | calculado | `Update: "PENDENTE DE APROVAÇÃO"` |
| **ASSINATURA** | conditional + calculado | `Visible: MOSTRARASSINATURA` |
| **CONTRATO** | conditional | `Visible: LookUp(CADASTROPRODUTO,PRODUTO=ComboBox1_2.Selected.PRODUTO,TIPODESPESA="MÃO DE OBRA")` |
| **CONTRATO** | conditional | `Visible: LookUp(FORNECEDORES,CADASTRO=ComboBox9.Selected.CADASTRO,'FORMA PGTO')="MEDIÇÃO"` |
| **MEDICAOPARCIAL** | conditional + calculado | `Visible: LookUp(CADASTROPRODUTO,PRODUTO=ComboBox1_2.Selected.PRODUTO,TIPODESPESA="MÃO DE OBRA")` |
| **MEDICAOPARCIAL** | calculado | `Update: ComboBox42_89.Selected.ID` |
| **UN** | calculado | `Update: ComboBox26_8.Selected.'UNIDADE MEDIDA'` |
| **UN** | calculado | `Update: ComboBox26.Selected.'UNIDADE MEDIDA'` |

### Controles fechados e fontes

| Campo | Controle | Items | SearchFields | IsSearchable |
|---|---|---|---|---|
| **AGRUPAR** | `Classic/DropDown` | `["EMPENHADO HOJE","EMPENHADO E LIQUIDADO HOJE","LIQUIDADO HOJE","LIQUIDADO E PAGO HOJE","EMPENHADO, LIQUIDADO E PAGO HOJE","PAGO HOJE"]` | `—` | `não declarado` |
| **AGRUPAR** | `Classic/DropDown` | `["RMS CRIADA","COMPRA EMPENHADA","COMPRA LIQUIDADA","COMPRA PAGA"]` | `—` | `não declarado` |
| **CONTA** (`field_14`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` |
| **CONTRATO** | `Classic/ComboBox` | `"=AddColumns( Sort(DESCRICAOMEDICOES,ID,SortOrder.Descending), Exibir, ID & \" - \" & FORNECEDOR & \" (IDCONTRATO - \" & NUMEROCONTRATO &\")\" ) "` | `["ASSINATURA"]` | `não declarado` |
| **CONTRATO** | `Classic/ComboBox` | `AddColumns( Filter( DESCRICAOMEDICOES, STATUS="ATIVO" ), Exibir, ID & " - " & FORNECEDOR & " (IDCONTRATO - " & NUMEROCONTRATO &")" )` | `["Exibir"]` | `não declarado` |
| **ETAPA** (`field_6`) | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_1.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` |
| **ETAPA** (`field_6`) | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` |
| **FILIAL** (`Title`) | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` |
| **FORNECEDOR** (`field_5`) | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` |
| **GERADESEMBOLSO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter(CADASTROPRODUTO,STATUS="ATIVO").PRODUTO` | `["field_1"]` | `não declarado` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter( CADASTROUNIDADEMEDIDA, STATUS = "ATIVO" )` | `["ComplianceAssetId"]` | `não declarado` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter( CADASTROPRODUTO, STATUS = "ATIVO", TIPO="DESPESA" ).PRODUTO` | `["field_1"]` | `não declarado` |
| **TIPO DESPESA** | `Classic/ComboBox` | `Filter( CADASTROTIPOMATERIAL, STATUS = "ATIVO" ).TIPO` | `["Title"]` | `não declarado` |
| **TIPO TRANSAÇÃO** (`field_1`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` |

### Lacunas específicas de LANCAMENTOS

- 4 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 5 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 6 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 2 campo(s) só aparecem em `Patch` (`ID 2`, `IDPGTOAGENDADO`); seus defaults/regras não são executados pelo formulário genérico.
- O contrato contém `STATUS`, embora o fluxo de criação observado imponha `APROVACAO = "PENDENTE DE APROVAÇÃO"`; são conceitos distintos e não devem ser substituídos entre si.
- `CONTRATO` e `MEDICAOPARCIAL` dependem de fornecedor/produto e de listas de medições; um select genérico sem filtro pode vincular o lançamento ao contrato errado.
- `AGRUPAR`, `UN`, `APROVACAO`, `MEDICAOPARCIAL` e `ASSINATURA` têm derivação automática em pelo menos um fluxo. Esses campos devem ser somente leitura/servidor ou preenchidos por regra de domínio no portal.

## Inventário por entidade/lista

### APONTAMENTOSCOMERCIAIS

- **Entidade no portal:** Apontamentos comerciais (`apontamentos-comerciais`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form33_2` — `F44- APONTAMENTOS COMERCIAIS.pa.yaml`; `Form33_3` — `G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATAINICIO**, **DESCRICAO**, **FILIAL**, **IDCONTRATO**, **IMOVEL**, **NOME**, **STATUS**, **TIPOMARCO**.
- **Campos gravados por Patch:** `DATAFATAL`, `DATAFIM`, `DATAINICIO`, `FILIAL`, `IDCONTRATO`, `IMOVEL`, `NOME`, `STATUS`, `TIPOMARCO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FILIAL** | `Classic/ComboBox` | `Filter(FILIAIS,STATUS="ATIVO")` | `["ComplianceAssetId"]` | `false` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( LANCAMENTOCOMPRAS, Exibir, ID & " - " & NOME ), "ID", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( LANCAMENTOCOMPRAS, Exibir, ID & " - " & NOME ), "IDCONTRATO", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=ComboBox5_21.Selected.FILIAL)` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=ComboBox5_22.Selected.FILIAL)` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **NOME** | `Classic/ComboBox` | `'CADASTRO CLIENTE_1'.NOME` | `["NOME"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVIDADE INICIADA","ATIVIDADE FINALIZADA"]` | `—` | `não declarado` | `não declarado` |
| **TIPOMARCO** | `Classic/ComboBox` | `TIPOMARCO` | `["TIPO"]` | `não declarado` | `false` |
| **TIPOMARCO** | `Classic/ComboBox` | `TIPOMARCO` | `["ComplianceAssetId"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 2 campo(s) só aparecem em `Patch` (`DATAFATAL`, `DATAFIM`); seus defaults/regras não são executados pelo formulário genérico.

### APONTAMENTOSFUNCIONARIOS

- **Entidade no portal:** Apontamentos de funcionários (`apontamentos-de-funcionarios`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 5 formulário(s), 5 chamado(s) por `SubmitForm`; 4 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_45` — `F17- CADASTRO INCONSISTÊNCIAS.pa.yaml`; `Form1_52` — `F33- CADASTRO HTML MEDIÇÃO UNITÁRIA.pa.yaml`; `Form1_54` — `F41- CADASTRO DIÁRIO DE OBRAS.pa.yaml`; `Form30_1` — `G18- HISTÓRICO INCONSISTENCIAS.pa.yaml`; `Form1_53` — `G31- HISTÓRICO CONTRATOS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ATIVIDADEEXECUTADA**, **DATA**, **DESCRICAO**, **ETAPA**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **IMPACTO ERRO/ACERTO** (`IMPACTOERRO`), **NUMEROCONTRATO**, **STATUS**, **TIPO**.
- **Campos condicionais:** **NUMEROCONTRATO** — `Visible: ComboBox42_108.Selected.Value="MEDIÇÃO" \|\| ComboBox42_108.Selected.Value="VALOR GLOBAL"` / `Visible: ComboBox42_118.Selected.Value="MEDIÇÃO"`.
- **Campos gravados por Patch:** `ATIVIDADEEXECUTADA`, `DATA`, `DESCRICAO`, `ETAPA`, `FILIAL`, `FORMAPGTO`, `FORNECEDOR`, `IMPACTO ERRO/ACERTO`, `IMPORTANTE`, `NUMEROCONTRATO`, `STATUS`, `TIPO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox99.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox99_4.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox99_6.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox104.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox99_5.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/ComboBox` | `["MEDIÇÃO","DIÁRIA","VALOR GLOBAL"]` | `["Value"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, EMPREITEIRO = "SIM" && STATUS = "ATIVO" ).CADASTRO` | `["Title"]` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IMPACTO ERRO/ACERTO** (`IMPACTOERRO`) | `Classic/DropDown` | `'CADASTRO IMPACTO'.Title` | `—` | `não declarado` | `não declarado` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Filter( EMPREITEIRO, STATUS="ATIVO" ), Exibir, ID & " - " & FORNECEDOR )` | `["ACR_x00c9_SCIMO"]` | `false` | `false` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Filter(EMPREITEIRO,STATUS="ATIVO"), Exibicao, Text(ID) & " - " & FORNECEDOR )` | `["Exibicao"]` | `false` | `false` |
| **STATUS** | `Classic/DropDown` | `["CORRIGIDO OU NÃO CORRIGÍVEL","PENDENTE DE CORREÇÃO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO** | `Classic/ComboBox` | `TIPOINCONSISTENCIA.TIPOINCONSISTENCIA3` | `["TIPOINCONSISTENCIA3"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 9 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 7 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 1 campo(s) só aparecem em `Patch` (`IMPORTANTE`); seus defaults/regras não são executados pelo formulário genérico.

### ATIVIDADE EXECUTADA

- **Entidade no portal:** Atividades executadas (`atividades-executadas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 5 formulário(s), 5 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `EDITARGRUPO_3` — `E9- EDITAR ATIVIDADE FUNCIONÁRIOS.pa.yaml`; `Form1_20` — `F10- CADASTRO FORNECEDOR.pa.yaml`; `Form1_23` — `F2- CADASTRODEMONSTRATIVOETAPA.pa.yaml`; `Form1_18` — `F31- CADASTRO ATIVIDADE FUNCIONÁRIOS.pa.yaml`; `Form1_24` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ATIVIDADE EXECUTADA**, **ETAPA**, **FILIAL**, **IMAGEM**.
- **Campos gravados por Patch:** `ETAPA`, `FILIAL`, `IMAGEM`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox85_19.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox85_25.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox85_49.Selected.FILIAL,STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox85_18.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox85_46.Selected.FILIAL,STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **IMAGEM** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTRO ALUGUEL

- **Entidade no portal:** Cadastros de aluguel (`cadastros-de-aluguel`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 5 formulário(s), 5 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_12` — `Screen2.pa.yaml`; `Form1_7` — `Screen3.pa.yaml`; `Form19_2` — `Screen5.pa.yaml`; `Form18_2` — `Screen5.pa.yaml`; `Form1_9` — `Screen9.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATA ASSINATURA** (`DATA`), **DATA REAJUSTE**, **DATA VENCIMENTO**, **DATANOVOCADASTRO** (`DATAPR_x00d3_XIMOCADASTRO`), **DESCRICAO**, **DESCRICAOIMOVEL**, **FORMA DE PGTO**, **IMÓVEL** (`IM_x00d3_VEL`), **INDEX**, **INQUILINO**, **NUM. CONTRATO** (`NUM_x002e_CONTRATO`), **STATUS**, **VALOR**.
- **Campos condicionais:** **Anexos** (`{Attachments}`) — `Visible: verformulario`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **DESCRICAOIMOVEL** | `Classic/DropDown` | `CADASTROIMOVEL.DESCRICAO` | `—` | `não declarado` | `não declarado` |
| **DESCRICAOIMOVEL** | `Classic/ComboBox` | `Filter(CADASTROIMOVEL,STATUS="ATIVO")` | `["DESCRICAO"]` | `não declarado` | `false` |
| **FORMA DE PGTO** | `Classic/DropDown` | `'FORMAPGTO LOCACAO'.FORMAPGTO` | `—` | `não declarado` | `não declarado` |
| **IMÓVEL** (`IM_x00d3_VEL`) | `Classic/ComboBox` | `CADASTROGRUPOIMÓVEL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **IMÓVEL** (`IM_x00d3_VEL`) | `Classic/ComboBox` | `Distinct(Filter(CADASTROGRUPOIMÓVEL,STATUS="ATIVO"),GRUPO)` | `["Value"]` | `não declarado` | `false` |
| **INDEX** | `Classic/DropDown` | `["IGP-M","SALÁRIO MÍNIMO","IPCA"]` | `—` | `não declarado` | `não declarado` |
| **INDEX** | `Classic/DropDown` | `["IGP-M","SALÁRIO MÍNIMO","IPCA","SEM CORREÇÃO"]` | `—` | `não declarado` | `não declarado` |
| **INQUILINO** | `Classic/ComboBox` | `'CADASTRO INQUILINO_1'.'NOME INQUILINO'` | `["NOME"]` | `não declarado` | `false` |
| **INQUILINO** | `Classic/ComboBox` | `Filter('CADASTRO INQUILINO_1',STATUS="ATIVO")` | `["NOME"]` | `não declarado` | `false` |
| **NUM. CONTRATO** (`NUM_x002e_CONTRATO`) | `Classic/DropDown` | `["REAJUSTE E VENCIMENTO EM 1 ANO", "REAJUSTE EM 1 ANO E VENCIMENTO EM 2 ANOS", "REAJUSTE EM 1 ANO E VENCIMENTO EM 3 ANOS", "REAJUSTE EM 1 ANO E VENCIMENTO EM 5 ANOS"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 7 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 3 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTRO CLIENTE_1

- **Entidade no portal:** Clientes (`clientes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form6` — `E8- EDITAR CLIENTE.pa.yaml`; `Form1_29` — `F27- CADASTRO CLIENTE.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CORRETOR**, **CPF**, **DEFINITIVO**, **DESCRIÇÃO** (`DESCRI_x00c7__x00c3_O`), **FILIAL**, **IMÓVEL ADQUIRIDO** (`IM_x00d3_VELADQUIRIDO`), **NOME**, **RG**, **STATUS**, **TELEFONE**.
- **Campos gravados por Patch:** `CORRETOR`, `CPF`, `DESCRIÇÃO`, `FILIAL`, `IMÓVEL ADQUIRIDO`, `NOME`, `RG`, `STATUS`, `TELEFONE`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CORRETOR** | `Classic/ComboBox` | `CORRETOR.NOMECORRETORA` | `["NOMECORRETORA"]` | `não declarado` | `false` |
| **DEFINITIVO** | `Classic/DropDown` | `["DEFINITIVO","RESCISÃO"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **IMÓVEL ADQUIRIDO** (`IM_x00d3_VELADQUIRIDO`) | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=DataCardValue231.Selected.FILIAL)` | `["IMOVEL"]` | `não declarado` | `false` |
| **IMÓVEL ADQUIRIDO** (`IM_x00d3_VELADQUIRIDO`) | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=DataCardValue221.Selected.FILIAL)` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 5 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTRO FAMÍLIA_1

- **Entidade no portal:** Famílias (`familias`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_1` — `F42- CADASTRO FAMÍLIA.pa.yaml`; `EDITARFAMÍLIA_1` — `G8- HISTÓRICO FAMÍLIA.pa.yaml`.
- **Campos visíveis:** **FAMÍLIA** (`field_1`), **GRUPO** (`Title`), **STATUS**.
- **Campos calculados/forçados:** **GRUPO** (`Title`) — `Update: '=ComboBox14.Selected.GRUPO '`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **GRUPO** (`Title`) | `Classic/ComboBox` | `Filter( CADASTROGRUPO, STATUS= "ATIVO" ).GRUPO` | `["Title"]` | `não declarado` | `false` |
| **GRUPO** (`Title`) | `Classic/ComboBox` | `CADASTROGRUPO.GRUPO` | `["Title"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### CADASTRO INQUILINO_1

- **Entidade no portal:** Inquilinos (`inquilinos`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form2_4` — `Screen1.pa.yaml`; `Form2_2` — `Screen3.pa.yaml`; `Form2_3` — `Screen9_1.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ATIVIDADE EXERCIDA**, **CNPJ ESTABELECIMENTO**, **CPF INQUILINO**, **DESCRIÇÃO DO IMÓVEL** (`DESCRI_x00c7__x00c3_ODOIM_x00d3_`), **DESCRICAO IMÓVEL P/ CONTRATO** (`DESCRICAOIM_x00d3_VELP_x002f_CON`), **DOCUMENTO DE IDENTIDADE**, **ENDEREÇO INQUILINO** (`ENDERE_x00c7_OINQUILINO`), **IMÓVEL LOCADO** (`IM_x00d3_VELLOCADO`), **NOME INQUILINO** (`NOME`), **STATUS**, **TELEFONE INQUILINO**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **DESCRIÇÃO DO IMÓVEL** (`DESCRI_x00c7__x00c3_ODOIM_x00d3_`) | `Classic/ComboBox` | `Distinct(Filter(CADASTROIMOVEL,STATUS="ATIVO"),DESCRICAO)` | `["Value"]` | `não declarado` | `false` |
| **DESCRIÇÃO DO IMÓVEL** (`DESCRI_x00c7__x00c3_ODOIM_x00d3_`) | `Classic/ComboBox` | `Distinct(CADASTROIMOVEL,DESCRICAO)` | `["Value"]` | `não declarado` | `false` |
| **DESCRIÇÃO DO IMÓVEL** (`DESCRI_x00c7__x00c3_ODOIM_x00d3_`) | `Classic/ComboBox` | `CADASTROIMOVEL.DESCRICAO` | `["DESCRICAO"]` | `não declarado` | `false` |
| **IMÓVEL LOCADO** (`IM_x00d3_VELLOCADO`) | `Classic/ComboBox` | `Distinct(Filter(CADASTROGRUPOIMÓVEL,STATUS="ATIVO"),GRUPO)` | `["Value"]` | `não declarado` | `false` |
| **IMÓVEL LOCADO** (`IM_x00d3_VELLOCADO`) | `Classic/ComboBox` | `Distinct(CADASTROGRUPOIMÓVEL,GRUPO)` | `["Value"]` | `não declarado` | `false` |
| **IMÓVEL LOCADO** (`IM_x00d3_VELLOCADO`) | `Classic/ComboBox` | `CADASTROGRUPOIMÓVEL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTRO TIPO DOCUMENTO

- **Entidade no portal:** Tipos de documento (`tipos-de-documento`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_28` — `F28- CADASTROTIPODOCUMENTO.pa.yaml`; `Form1_59` — `F29- CADASTRO DOCUMENTOS_2.pa.yaml`; `Form1_62` — `G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml`; `EDITARGRUPO_10` — `G26- HISTÓRICOTIPODOCUMENTO.pa.yaml`.
- **Campos visíveis:** **GRUPO**, **HOMOLOGAÇÃO** (`HOMOLOGA_x00c7__x00c3_O`), **OBRIGATORIO**, **TIPODOCUMENTO**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **GRUPO** | `Classic/ComboBox` | `Filter( GRUPODOCFILIAL, HOMOLOGAÇÃO = DataCardValue130.Selected.Value )` | `["GRUPO"]` | `não declarado` | `false` |
| **GRUPO** | `Classic/ComboBox` | `Filter( GRUPODOCFILIAL, HOMOLOGAÇÃO = DataCardValue130_12.Selected.Value )` | `["GRUPO"]` | `não declarado` | `false` |
| **GRUPO** | `Classic/ComboBox` | `Filter( GRUPODOCFILIAL, HOMOLOGAÇÃO = DataCardValue130_11.Selected.Value )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **GRUPO** | `Classic/ComboBox` | `GRUPODOCFILIAL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **HOMOLOGAÇÃO** (`HOMOLOGA_x00c7__x00c3_O`) | `Classic/DropDown` | `["HOMOLOGAÇÃO MÃO DE OBRA","HOMOLOGAÇÃO FILIAL","HOMOLOGAÇÃO CONTRATO","HOMOLOGAÇÃO COMERCIAL","HOMOLOGAÇÃO ETAPA OBRA"]` | `—` | `não declarado` | `não declarado` |
| **HOMOLOGAÇÃO** (`HOMOLOGA_x00c7__x00c3_O`) | `Classic/DropDown` | `["HOMOLOGAÇÃO MÃO DE OBRA","HOMOLOGAÇÃO FILIAL","HOMOLOGAÇÃO CONTRATO","HOMOLOGAÇÃO COMERCIAL"]` | `—` | `não declarado` | `não declarado` |
| **OBRIGATORIO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### CADASTROCIDADE

- **Entidade no portal:** Cidades (`cidades`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form4` — `F40- CADASTRO CIDADE.pa.yaml`; `Form32` — `G36- HISTÓRICO CIDADE.pa.yaml`.
- **Campos visíveis:** **Título** (`Title`).

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### CADASTROCONTA

- **Entidade no portal:** Contas (`contas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form52` — `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `Form52_2` — `GALERIACONTA.pa.yaml`; `Form52_1` — `I10- GERAL SUPRIMENTOS.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **CONTA** (`Title`), **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTROGRUPO

- **Entidade no portal:** Cadastro de grupos (`cadastro-de-grupos`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1` — `F12- CADASTRO GRUPO.pa.yaml`; `EDITARGRUPO_11` — `G10- HISTÓRICO GRUPO.pa.yaml`.
- **Campos visíveis:** **GRUPO** (`Title`), **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### CADASTROGRUPOIMÓVEL

- **Entidade no portal:** Grupos de imóveis (`grupos-de-imoveis`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form3_6` — `Screen1.pa.yaml`; `Form3_8` — `Screen3.pa.yaml`; `Form3_5` — `Screen8.pa.yaml`.
- **Campos visíveis:** **GRUPO**, **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### CADASTROIMOBILIZADO

- **Entidade no portal:** Cadastro de imobilizados (`cadastro-de-imobilizados`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_47` — `F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml`; `Form1_40` — `F20- CADASTRO PRODUTO IMOBILIZADO.pa.yaml`; `Form15` — `G14- HISTÓRICOIMOBILIZADO.pa.yaml`.
- **Campos visíveis:** **FUNCAO**, **GRUPOIMOBILIZADO**, **IMOBILIZADO**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FUNCAO** | `Classic/ComboBox` | `FUNCAOIMOBILIZADO.FUNCAO` | `["FUNCAO"]` | `não declarado` | `false` |
| **GRUPOIMOBILIZADO** | `Classic/ComboBox` | `'GRUPO IMOBILIZADOS'.GRUPOIMOBILIZADOS` | `["GRUPOIMOBILIZADOS"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### CADASTROIMOVEL

- **Entidade no portal:** Cadastro de imóveis para locação (`cadastro-de-imoveis-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form3_10` — `Screen1.pa.yaml`; `Form3_9` — `Screen3.pa.yaml`; `Form3_4` — `Screen9_2.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CIDADE**, **DESCRICAO**, **ENDERECO**, **IMOVEL**, **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CIDADE** | `Classic/DropDown` | `["DIVINÓPOLIS","LUZ","BELO HORIZONTE","CONGONHAS","CARMO DA MATA","CABO FRIO"]` | `—` | `não declarado` | `não declarado` |
| **CIDADE** | `Classic/DropDown` | `["DIVINÓPOLIS","LUZ","BELO HORIZONTE","CONGONHAS","NOVA LIMA"]` | `—` | `não declarado` | `não declarado` |
| **CIDADE** | `Classic/DropDown` | `["DIVINÓPOLIS","LUZ","BELO HORIZONTE","CONGONHAS","CABO FRIO"]` | `—` | `não declarado` | `não declarado` |
| **IMOVEL** | `Classic/ComboBox` | `Filter(CADASTROGRUPOIMÓVEL,STATUS="ATIVO")` | `["GRUPO"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `CADASTROGRUPOIMÓVEL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTROPRODUTO

- **Entidade no portal:** Produtos (`produtos`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 4 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_5` — `F37- CADASTRO PRODUTO.pa.yaml`; `Form1_34` — `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `Form1_44` — `F44- LANÇAMENTO RECEITA.pa.yaml`; `EDITARGRUPO_12` — `G38- HISTÓRICO PRODUTO.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **GERADESEMBOLSO**, **PRODUTO** (`field_1`), **STATUS** (`SATUS`), **SUBFAMÍLIA** (`Title`), **TIPO**, **TIPODESPESA**, **UNIDADE**.
- **Campos gravados por Patch:** `GERADESEMBOLSO`, `PRODUTO`, `STATUS`, `SUBFAMÍLIA`, `TIPO`, `TIPODESPESA`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **GERADESEMBOLSO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** (`SATUS`) | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** (`SATUS`) | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **SUBFAMÍLIA** (`Title`) | `Classic/ComboBox` | `Filter( CADASTROSUBFAMÍLIA, STATUS= "ATIVO" ).'SUBFAMÍLIAS CADASTRADAS'` | `["field_1"]` | `não declarado` | `false` |
| **SUBFAMÍLIA** (`Title`) | `Classic/ComboBox` | `CADASTROSUBFAMÍLIA.'SUBFAMÍLIAS CADASTRADAS'` | `["field_1"]` | `não declarado` | `false` |
| **TIPO** | `Classic/DropDown` | `["DESPESA","RECEITA"]` | `—` | `não declarado` | `não declarado` |
| **TIPODESPESA** | `Classic/ComboBox` | `Filter( CADASTROTIPOMATERIAL, STATUS = "ATIVO" ).TIPO` | `["Title"]` | `não declarado` | `false` |
| **UNIDADE** | `Classic/ComboBox` | `Filter( CADASTROUNIDADEMEDIDA, STATUS = "ATIVO" )` | `["ComplianceAssetId"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 3 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### CADASTROSUBFAMÍLIA

- **Entidade no portal:** Cadastro de subfamílias (`cadastro-de-subfamilias`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_2` — `F43- CADASTRO SUBFAMÍLIA.pa.yaml`; `EDITARSUBFAMÍLIA_1` — `G35- HISTÓRICO SUBFAMÍLIA.pa.yaml`.
- **Campos visíveis:** **FAMÍLIA** (`Title`), **STATUS**, **SUBFAMÍLIAS CADASTRADAS** (`field_1`), **TIPO** (`field_3`).

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FAMÍLIA** (`Title`) | `Classic/ComboBox` | `Filter( 'CADASTRO FAMÍLIA_1', STATUS= "ATIVO" ).FAMÍLIA` | `["field_1"]` | `não declarado` | `false` |
| **FAMÍLIA** (`Title`) | `Classic/ComboBox` | `'CADASTRO FAMÍLIA_1'.FAMÍLIA` | `["field_1"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO** (`field_3`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **TIPO** (`field_3`) | `Classic/ComboBox` | `Filter( CADASTROTIPOMATERIAL, STATUS = "ATIVO" ).TIPO` | `["Title"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### CADASTROTAREFAS

- **Entidade no portal:** Cadastro de tarefas (`cadastro-de-tarefas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `CADASTROASSOCIAÇÃO` — `F1- CADASTRO ASSOCIAÇÃO.pa.yaml`; `CADASTROASSOCIAÇÃO_7` — `G5- HISTÓRICO ASSOCIAÇÃO.pa.yaml`.
- **Campos visíveis:** **ASSOCIAÇÃO** (`field_1`), **TIPO**, **Title**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **TIPO** | `Classic/DropDown` | `["ASSOCIAÇÃO OBRA","ASSOCIAÇÃO SEDE"]` | `—` | `não declarado` | `não declarado` |
| **Title** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### CADASTROTIPOMATERIAL

- **Entidade no portal:** Tipos de material (`tipos-de-material`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_3` — `F38- CADASTRO TIPO MATERIAL.pa.yaml`; `Form13` — `G2- HISTÓRICO TIPO MATERIAL.pa.yaml`.
- **Campos visíveis:** **STATUS**, **TIPO** (`Title`).

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### CADASTROUNIDADEMEDIDA

- **Entidade no portal:** Unidades de medida (`unidades-de-medida`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_4` — `F39- CADASTRO UNIDADEMEDIDA.pa.yaml`; `Form23` — `G41- HISTÓRICO UNIDADE MEDIDA.pa.yaml`.
- **Campos visíveis:** **STATUS**, **UNIDADE MEDIDA** (`Title`).

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### CORRETOR

- **Entidade no portal:** Corretores (`corretores`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_32` — `F22- CADASTRO CORRETOR.pa.yaml`; `Form1_49` — `G24- HISTÓRICO CORRETOR.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **CIDADE**, **E_x002d_MAIL**, **NOMECORRETORA**, **REPRESENTANTE**, **STATUS**, **TELEFONE**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CIDADE** | `Classic/DropDown` | `CADASTROCIDADE.Título` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### DEMONSTRATIVOETAPA

- **Entidade no portal:** Demonstrativos de etapa (`demonstrativos-de-etapa`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `CADASTROASSOCIAÇÃO_10` — `F10- CADASTRO FORNECEDOR.pa.yaml`; `CADASTROASSOCIAÇÃO_6` — `F2- CADASTRODEMONSTRATIVOETAPA.pa.yaml`; `CADASTROASSOCIAÇÃO_9` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`; `Form20_1` — `G23- HISTÓRICO DESCRITIVO ETAPA.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **ATIVIDADEEXECUTADA**, **DATAEXECUTADO**, **DATAPREVISTO**, **ETAPA**, **FILIAL**, **FORNECEDOR**, **IMOVEL**, **OBSERVACOESFINALIZACAO**, **QTDEXECUTADA**, **STATUS**, **TOTAL**.
- **Campos gravados por Patch:** `ATIVIDADEEXECUTADA`, `DATAEXECUTADO`, `ETAPA`, `FILIAL`, `FORNECEDOR`, `IMOVEL`, `QTDEXECUTADA`, `STATUS`, `TOTAL`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `Filter( 'ATIVIDADE EXECUTADA', FILIAL = ComboBox92_6.Selected.FILIAL ,ETAPA=ComboBox11_49.Selected.Value )` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `"= Filter( 'ATIVIDADE EXECUTADA', FILIAL = ComboBox92_2.Selected.FILIAL,ETAPA=ComboBox11_8.Selected.Value ) "` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `Filter( 'ATIVIDADE EXECUTADA', FILIAL = ComboBox92_5.Selected.FILIAL ,ETAPA=ComboBox11_46.Selected.Value )` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `Filter( 'ATIVIDADE EXECUTADA', IsBlank(ComboBox92_1.Selected.FILIAL) \|\| FILIAL = ComboBox92_1.Selected.FILIAL )` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92_6.Selected.FILIAL, STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92_2.Selected.FILIAL,STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92_5.Selected.FILIAL, STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92_1.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, EMPREITEIRO = "SIM" && STATUS = "ATIVO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox92_6.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox92_2.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox92_5.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox92_1.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **STATUS** | `Classic/ComboBox` | `["ATIVIDADE INICIADA","ATIVIDADE FINALIZADA"]` | `["Value"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 6 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### DESCRICAOMEDICOES

- **Entidade no portal:** Descrições de medição (`descricoes-de-medicao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Formulários:** `Form18` — `F33- CADASTRO HTML MEDIÇÃO UNITÁRIA.pa.yaml`; `Form23_1` — `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`; `Form24` — `G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml`; `Form7_3` — `G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ASSINATURA**, **ATIVIDADE**, **AVALIACAO**, **DATA FIM**, **DATA INÍCIO** (`DATAIN_x00cd_CIO`), **DEMONSTRATIVOETAPA**, **ETAPA OBRA**, **FILIAL**, **FORNECEDOR**, **IDLANCAMENTO**, **NUMEROCONTRATO**, **OBSERVACAO**, **PENDENCIAS**, **QTD**, **SALDOCONTRATO**, **STATUS**, **SUPRIMENTOS**, **TIPODEMEDICAO**, **VALORTOTAL**.
- **Campos calculados/forçados:** **ASSINATURA** — `Update: VARASSINATURA`.
- **Campos gravados por Patch:** `ASSINATURA`, `SUPRIMENTOS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADE** | `Classic/ComboBox` | `Filter('ATIVIDADE EXECUTADA',IMAGEM="SIM")` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADE** | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'.'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **DEMONSTRATIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FORNECEDOR=ComboBox42_129.Selected.FORNECEDOR && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **DEMONSTRATIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FORNECEDOR=DataCardValue453_1.Text && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **ETAPA OBRA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox97_4.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( EMPREITEIRO, STATUS = "ATIVO" ).FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Distinct( Filter( EMPREITEIRO, FORNECEDOR = ComboBox42_129.Selected.FORNECEDOR, STATUS = "ATIVO" ), ID ), Result, Text(Value) )` | `["Result"]` | `não declarado` | `false` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Distinct( EMPREITEIRO, ID ), Result, Text(Value) )` | `["Result"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **SUPRIMENTOS** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 6 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### DESCRITIVOPRESENCA

- **Entidade no portal:** Descrições de presença (`descricoes-de-presenca`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form20` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`; `Form25_1` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`; `Form20_2` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`; `Form20_3` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`.
- **Campos visíveis:** **ATIVIDADEEXECUTADA**, **DATA**, **DATAPGTO**, **DESCRITIVO ETAPA** (`OBSERVA_x00c7__x00c3_O`), **ETAPA**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **HORÁRIO** (`HOR_x00c1_RIO`), **HORARIOENTRADA2**, **HORARIOSAIDA1**, **HORARIOSAIDA2**, **IDDESCRITIVOETAPA**, **IDMEDICAO**, **IDMEDICAOPARCIAL**, **IDPGTO**, **IMOVEL**, **OBS**, **PRESENCA**, **PROFISSAO**, **STATUS**, **VLORDIARIO**.
- **Campos condicionais:** **IDMEDICAO** — `Visible: Gallery2_33.Selected.FORMAPGTO<>"DIÁRIA"`; **IDMEDICAOPARCIAL** — `Visible: Gallery2_33.Selected.FORMAPGTO<>"DIÁRIA"`; **MOTIVACAO** — `Visible: DataCardValue453.Selected.Value="AUSENTE" \|\| With( { varValorCorreto: Value( Coalesce( LookUp( FORNECEDORES, CADASTRO = ComboBox93.Selected.CADASTRO, 'VLR DIARIO' ), 0 ) ), varValorInformado: Value( Coalesce( D…` / `Visible: If(DataCardValue453_2.Selected.Value="AUSENTE",true,false) \|\| DataCardValue431_1.Text<>LookUp(FORNECEDORES,CADASTRO=ComboBox42_45.Selected.CADASTRO,'VLR DIARIO')` / `Visible: Dropdown1_7.Selected.Value="AUSENTE"`; **STATUS** — `Visible: Dropdown1_7.Selected.Value="AUSENTE"`; **VLORDIARIO** — `Visible: Gallery2_33.Selected.FORMAPGTO="DIÁRIA"`.
- **Campos calculados/forçados:** **FORNECEDOR** — `Update: ComboBox42_45.Selected.CADASTRO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `Filter('ATIVIDADE EXECUTADA',FILIAL=ComboBox92.Selected.FILIAL,ETAPA=LookUp(DEMONSTRATIVOETAPA,ID=ComboBox42_135.Selected.ID,ETAPA))` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `Filter('ATIVIDADE EXECUTADA',FILIAL=Gallery2_33.Selected.FILIAL,ETAPA=LookUp(DEMONSTRATIVOETAPA,ID=ComboBox42_148.Selected.ID,ETAPA))` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **DESCRITIVO ETAPA** (`OBSERVA_x00c7__x00c3_O`) | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = ComboBox92_4.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " &ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox92_4.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = Gallery2_33.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/ComboBox` | `["MEDIÇÃO","DIÁRIA","VALOR GLOBAL"]` | `["Value"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, EMPREITEIRO = "SIM" && STATUS = "ATIVO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Distinct( Filter( DESCRITIVOPRESENCA, STATUS = "PENDENTE PGTO" ), FORNECEDOR )` | `["Value"]` | `não declarado` | `false` |
| **IDDESCRITIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = ComboBox92.Selected.FILIAL, STATUS="ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **IDDESCRITIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = Gallery2_33.Selected.FILIAL, STATUS="ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **IDMEDICAO** | `Classic/ComboBox` | `AddColumns( Filter(EMPREITEIRO,STATUS="ATIVO"), Exibicao, Text(ID) & " - " & FORNECEDOR )` | `["ACR_x00c9_SCIMO"]` | `não declarado` | `false` |
| **IDMEDICAO** | `Classic/ComboBox` | `AddColumns( Filter( EMPREITEIRO, STATUS="ATIVO" ), Exibir, ID & " - " & FORNECEDOR )` | `["Exibir"]` | `não declarado` | `false` |
| **IDMEDICAOPARCIAL** | `Classic/ComboBox` | `AddColumns( If( IsBlank(ComboBox42_98.Selected.ID), Filter(DESCRICAOMEDICOES,STATUS="ATIVO"), Filter( DESCRICAOMEDICOES, NUMEROCONTRATO = Text(ComboBox42_98.Selected.ID), STATUS = "ATIVO" ) ), Display, ID & " - " & FORNECEDOR )` | `["Display"]` | `não declarado` | `false` |
| **IDMEDICAOPARCIAL** | `Classic/ComboBox` | `AddColumns( If( IsBlank(ComboBox42_147.Selected.ID), Filter(DESCRICAOMEDICOES,STATUS="ATIVO"), Filter( DESCRICAOMEDICOES, NUMEROCONTRATO = Text(ComboBox42_147.Selected.ID), STATUS = "ATIVO" ) ), Display, ID & " - " & FORNECEDOR )` | `["ASSINATURA"]` | `não declarado` | `false` |
| **IDPGTO** | `Classic/ComboBox` | `AddColumns( Sort(LANCAMENTOS,ID,SortOrder.Descending), DisplayText, Text(ID) & " - " & FORNECEDOR & " - " & Text('DATA PGTO EFETUADO', "[$-pt-BR]dd/mm/yyyy") )` | `["DisplayText"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'IMOVEL CADASTRADO', FILIAL = ComboBox92.Selected.FILIAL ), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox92_4.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'IMOVEL CADASTRADO', FILIAL = Gallery2_33.Selected.FILIAL ), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **PRESENCA** | `Classic/DropDown` | `["PRESENTE","PENDENTE","AUSENTE"]` | `—` | `não declarado` | `não declarado` |
| **PROFISSAO** | `Classic/ComboBox` | `Filter(PROFISSÃO, STATUS = "ATIVO").PROFISSÃO` | `["PROFISS_x00c3_O"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PAGO","PENDENTE PGTO","AUSENTE"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE PGTO","PAGO","AUSENTE"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 5 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 14 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 12 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### DESPESASRECORRENTES

- **Entidade no portal:** Despesas recorrentes (`despesas-recorrentes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_36` — `F21- CADASTRO DESPESA RECORRENTE.pa.yaml`; `Form1_39` — `G19- HISTÓRICOLOCACOES.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATAFIM**, **DATAINICIO**, **DESCRICAOPGTO**, **EQUIPAMENTO**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **IMOVEL**, **PRAZO ESTIMADO**, **QTD**, **RECORRENCIA**, **RESPONSAVEL LOCACAO**, **STATUS**, **VALOR ARBITRADO**, **VALOR MENSAL**, **VALORTOTALESPERADO**.
- **Campos condicionais:** **RECORRENCIADIAS** — `Visible: IsBlank(DataCardValue470.Selected.Value)` / `Visible: IsBlank(DataCardValue470_2.Selected.Value)`.
- **Campos calculados/forçados:** **RECORRENCIA** — `Update: Switch( DataCardValue470.Selected.Value, "Diário", "Day", "Semanal", "Week", "Mensal", "Month", "Anual", "Year" )` / `Update: If( IsBlank(DataCardValue470_2.Selected.Value), Blank(), Switch( DataCardValue470_2.Selected.Value, "Diário", "Day", "Semanal", "Week", "Mensal", "Month", "Anual", "Year" ) )`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **EQUIPAMENTO** | `Classic/ComboBox` | `Filter( CADASTROPRODUTO, STATUS = "ATIVO" ).PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **EQUIPAMENTO** | `Classic/ComboBox` | `CADASTROPRODUTO.PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/DropDown` | `CADASTROCONTA.CONTA` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter( 'IMOVEL CADASTRADO', FILIAL = ComboBox65_1.Selected.FILIAL )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter( 'IMOVEL CADASTRADO', FILIAL = ComboBox65_2.Selected.FILIAL )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **RECORRENCIA** | `Classic/DropDown` | `["Diário", "Semanal", "Mensal", "Anual"]` | `—` | `não declarado` | `não declarado` |
| **RESPONSAVEL LOCACAO** | `Classic/ComboBox` | `Filter(FORNECEDORES,FILIAL="000 - ESCRITÓRIO CENTRAL",TIPO="MÃO DE OBRA",STATUS="ATIVO").CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **RESPONSAVEL LOCACAO** | `Classic/ComboBox` | `Filter(FORNECEDORES,FILIAL="000 - ESCRITÓRIO CENTRAL",TIPO="MÃO DE OBRA").CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### DIÁRIO DE OBRAS

- **Entidade no portal:** Diários de obras (`diarios-de-obras`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `EDIATARDIÁRIO` — `E3- EDITAR DIÁRIO OBRAS.pa.yaml`; `Form4_1` — `F41- CADASTRO DIÁRIO DE OBRAS.pa.yaml`; `Form4_2` — `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`; `Form5` — `G39- HISTÓRICO DIÁRIO DE OBRAS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ATIVIDADES EXECUTADAS**, **DATA**, **FILIAL**, **INFORMAÇÕES CLIMÁTICAS** (`INFORMA_x00c7__x00d5_ESCLIM_x00c`), **OCORRÊNCIAS E IMPREVISTOS** (`OCORR_x00ca_NCIASEIMPREVISTOS`), **RESPONSAVELTECNICO**, **SITUAÇÃO ESTOQUE** (`DESCRI_x00c7__x00c3_O`), **STATUS**.
- **Campos condicionais:** **Anexos** (`{Attachments}`) — `Visible: arquivos`.
- **Campos calculados/forçados:** **SITUAÇÃO ESTOQUE** (`DESCRI_x00c7__x00c3_O`) — `Update: %FieldValue.ID%.Text`.
- **Campos gravados por Patch:** `DATA`, `FILIAL`, `RESPONSAVELTECNICO`, `STATUS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FILIAL** | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **INFORMAÇÕES CLIMÁTICAS** (`INFORMA_x00c7__x00d5_ESCLIM_x00c`) | `Classic/DropDown` | `["ENSOLARADO","POUCHO CHUVOSO","MUITO CHUVOSO"]` | `—` | `não declarado` | `não declarado` |
| **INFORMAÇÕES CLIMÁTICAS** (`INFORMA_x00c7__x00d5_ESCLIM_x00c`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE","CONCLUÍDO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 3 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### DOCUMENTOS_1

- **Entidade no portal:** Documentos operacionais (`documentos-operacionais`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 5 formulário(s), 5 chamado(s) por `SubmitForm`; 4 ocorrência(s) de `Patch`.
- **Formulários:** `Form42` — `F29- CADASTRO DOCUMENTOS_2.pa.yaml`; `Form1_57` — `F44- APONTAMENTOS COMERCIAIS.pa.yaml`; `Form1_61` — `G25- HISTÓRICO APONTAMENTO COMERCIAL.pa.yaml`; `Form36_3` — `G47- HISTÓRICO DOCUMENTOS COMERCIAL_1.pa.yaml`; `Form42_1` — `G47- HISTÓRICO DOCUMENTOS COMERCIAL_1.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATA**, **DATASUBMETIDO**, **DATAVALIDADE**, **ETAPA**, **FILIAL**, **IMOVEL**, **NUMCONTRATO**, **OBS**, **PESSOARELACIONADA**, **PESSOARELACIONADA** (`CLIENTE`), **STATUS**, **TIPODOCUMENTO**, **TIPOHOMOLOGACAO**, **TIPOMARCO**.
- **Campos condicionais:** **NUMCONTRATO** — `Visible: Or( DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO CONTRATO", DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO COMERCIAL" )` / `Visible: Or( DataCardValue130_14.Selected.Value = "HOMOLOGAÇÃO CONTRATO", DataCardValue130_14.Selected.Value = "HOMOLOGAÇÃO COMERCIAL" )`; **TIPOMARCO** — `Visible: DataCardValue130_13.Selected.Value="HOMOLOGAÇÃO COMERCIAL"` / `Visible: DataCardValue130_14.Selected.Value="HOMOLOGAÇÃO COMERCIAL"`.
- **Campos gravados por Patch:** `DATASUBMETIDO`, `ETAPA`, `FILIAL`, `IMOVEL`, `NUMCONTRATO`, `PESSOARELACIONADA`, `STATUS`, `TIPODOCUMENTO`, `TIPOHOMOLOGACAO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = DataCardValue207_7.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = DataCardValue207_8.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'IMOVEL CADASTRADO', FILIAL = DataCardValue207_7.Selected.FILIAL ), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=DataCardValue207_4.Selected.FILIAL)` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter('IMOVEL CADASTRADO',FILIAL=DataCardValue207_5.Selected.FILIAL)` | `["IMOVEL"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `With( { varImovelCliente: LookUp( 'CADASTRO CLIENTE_1', NOME = ComboBox45_4.Selected.ValorCombo && FILIAL = DataCardValue207_8.Selected.FILIAL, 'IMÓVEL ADQUIRIDO' ), varImovelSalvo: Parent.Default }, If( DataCardValue130_15.Selected.Value = "HOMOLOGAÇÃO COMERCIAL", Distinct( Filter( 'IMOVEL CADASTRADO', FILIAL = DataCardValue207_8.Selected.FILIAL && ( IMOVEL = varImovelCliente \|\| IMOVEL = varImovelSalvo ) ), IMOVEL …` | `["Value"]` | `não declarado` | `false` |
| **NUMCONTRATO** | `Classic/ComboBox` | `If( DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO CONTRATO", AddColumns( Distinct( Filter( EMPREITEIRO, FORNECEDOR = ComboBox45_1.Selected.ValorCombo, STATUS = "ATIVO", FILIAL = DataCardValue207_7.Selected.FILIAL ), ID & " - " & ATIVIDADEEXECUTADA ), Exibir, Text(Value) ), If( DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO COMERCIAL", SortByColumns( AddColumns( Filter( LANCAMENTOCOMPRAS, FILIAL = DataCardValu…` | `["Exibir"]` | `não declarado` | `false` |
| **NUMCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter(LANCAMENTOCOMPRAS,FILIAL=DataCardValue207_4.Selected.FILIAL), Exibir, ID & " - " & NOME ), "IDCONTRATO", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **NUMCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter(LANCAMENTOCOMPRAS,FILIAL=DataCardValue207_5.Selected.FILIAL), Exibir, ID & " - " & NOME ), "IDCONTRATO", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **NUMCONTRATO** | `Classic/ComboBox` | `If( DataCardValue130_14.Selected.Value = "HOMOLOGAÇÃO COMERCIAL", ShowColumns( AddColumns( Filter( LANCAMENTOCOMPRAS, FILIAL = DataCardValue207_8.Selected.FILIAL && NOME = ComboBox45_4.Selected.ValorCombo ), Exibir, Text(ID) & " - " & NOME ), ID, Exibir ), DataCardValue130_14.Selected.Value = "HOMOLOGAÇÃO CONTRATO", ShowColumns( AddColumns( Filter( EMPREITEIRO, FORNECEDOR = ComboBox45_4.Selected.ValorCombo, STATUS =…` | `["Exibir"]` | `não declarado` | `false` |
| **PESSOARELACIONADA** | `Classic/ComboBox` | `If( DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO FILIAL", ForAll( FORNECEDORES As RegistroFornecedor, { ValorCombo: RegistroFornecedor.CADASTRO } ), If( Or( DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO CONTRATO", DataCardValue130_13.Selected.Value = "HOMOLOGAÇÃO MÃO DE OBRA" ), ForAll( Filter( FORNECEDORES, EMPREITEIRO = "SIM" && STATUS = "ATIVO" ) As RegistroFornecedor, { ValorCombo: RegistroFornecedor.CA…` | `["ValorCombo"]` | `não declarado` | `false` |
| **PESSOARELACIONADA** | `Classic/ComboBox` | `With( { _TipoHomologacao: DataCardValue130_14.Selected.Value, _PessoaSalva: Coalesce( Parent.Default, "" ) }, With( { _Base: If( _TipoHomologacao = "HOMOLOGAÇÃO FILIAL", ForAll( FORNECEDORES As RegistroFornecedor, { ValorCombo: Text( RegistroFornecedor.CADASTRO ) } ), If( _TipoHomologacao = "HOMOLOGAÇÃO CONTRATO", ForAll( Filter( FORNECEDORES, EMPREITEIRO = "SIM" ) As RegistroFornecedor, { ValorCombo: Text( Registro…` | `["ValorCombo"]` | `não declarado` | `false` |
| **PESSOARELACIONADA** (`CLIENTE`) | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', FILIAL = DataCardValue207_4.Selected.FILIAL )` | `["NOME"]` | `não declarado` | `false` |
| **PESSOARELACIONADA** (`CLIENTE`) | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', FILIAL = DataCardValue207_5.Selected.FILIAL )` | `["NOME"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE","SUBMETIDO"]` | `—` | `não declarado` | `não declarado` |
| **TIPODOCUMENTO** | `Classic/ComboBox` | `Filter( 'CADASTRO TIPO DOCUMENTO', HOMOLOGAÇÃO = DataCardValue130_13.Selected.Value ).TIPODOCUMENTO` | `["TIPODOCUMENTO"]` | `não declarado` | `false` |
| **TIPODOCUMENTO** | `Classic/ComboBox` | `Filter( 'CADASTRO TIPO DOCUMENTO', HOMOLOGAÇÃO = "HOMOLOGAÇÃO COMERCIAL" ).TIPODOCUMENTO` | `["TIPODOCUMENTO"]` | `não declarado` | `false` |
| **TIPODOCUMENTO** | `Classic/ComboBox` | `Filter( 'CADASTRO TIPO DOCUMENTO', HOMOLOGAÇÃO = DataCardValue130_14.Selected.Value ).TIPODOCUMENTO` | `["TIPODOCUMENTO"]` | `não declarado` | `false` |
| **TIPOHOMOLOGACAO** | `Classic/DropDown` | `["HOMOLOGAÇÃO MÃO DE OBRA","HOMOLOGAÇÃO FILIAL","HOMOLOGAÇÃO CONTRATO","HOMOLOGAÇÃO COMERCIAL","HOMOLOGAÇÃO ETAPA OBRA"]` | `—` | `não declarado` | `não declarado` |
| **TIPOMARCO** | `Classic/ComboBox` | `Filter(APONTAMENTOSCOMERCIAIS,STATUS="ATIVIDADE INICIADA" && NOME=ComboBox45_1.Selected.ValorCombo).TIPOMARCO` | `["TIPOMARCO"]` | `não declarado` | `false` |
| **TIPOMARCO** | `Classic/ComboBox` | `TIPOMARCO` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **TIPOMARCO** | `Classic/ComboBox` | `If( IsBlank(ComboBox45_4.Selected.ValorCombo), FirstN( APONTAMENTOSCOMERCIAIS, 0 ), SortByColumns( Filter( APONTAMENTOSCOMERCIAIS, NOME = ComboBox45_4.Selected.ValorCombo ), "TIPOMARCO", SortOrder.Ascending ) )` | `["TIPOMARCO"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 10 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 7 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### EMPREITEIRO

- **Entidade no portal:** Empreiteiros (`empreiteiros`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 5 formulário(s), 5 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_8` — `E12- EDITAR CONTRATO EMPREITEIRO.pa.yaml`; `Form1_6` — `F32- CADASTRO CONTRATO EMPREITEIRO.pa.yaml`; `Form7_1` — `G31- HISTÓRICO CONTRATOS.pa.yaml`; `Form8` — `G31- HISTÓRICO CONTRATOS.pa.yaml`; `Form1_11` — `G31- HISTÓRICO CONTRATOS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ASSINATURA**, **ATIVIDADEEXECUTADA**, **AVALIACAO SERVICO**, **CONTRATO**, **CRONOGRAMA**, **DATA**, **DATA FIM**, **DATA INÍCIO** (`DATAIN_x00cd_CIO`), **DESCRITIVOETAPA**, **DETALHAMENTOSERVICO**, **ETAPA OBRA**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **GARANTIA**, **IDCONTRATO**, **IDESTIMATIVA**, **LOCALSERVICO**, **OBRIGACOESCONTRATADO**, **OBSERVACAO AVALIACAO**, **PENALIDADES**, **PENDENCIAS**, **STATUS**, **TIPO DE MEDIÇÃO** (`TIPODEMEDI_x00c7__x00c3_O`), **VALORGLOBALESTIMADO**, **VALORTOTAL**, **VALORTOTALMEDICOES**.
- **Campos condicionais:** **VALORTOTAL** — `Visible: If(DataCardValue121.Text="MEDIÇÃO VALOR GLOBAL",true,false)` / `Visible: Dropdown20.Selected.Value="MEDIÇÃO VALOR GLOBAL"`; **VALORUNITARIO** — `Visible: If(DataCardValue121.Text="MEDIÇÃO VALOR UNITÁRIO",true,false)` / `Visible: Dropdown20.Selected.Value="MEDIÇÃO VALOR UNITÁRIO"`.
- **Campos calculados/forçados:** **ASSINATURA** — `Update: VARASSINATURA`; **CRONOGRAMA** — `Update: TextInput20_23.Text` / `Update: TextInput20_16.Text`; **DETALHAMENTOSERVICO** — `Update: TextInput20_20.Text` / `Update: TextInput20_13.Text`; **FORMAPGTO** — `Update: TextInput20_21.Text` / `Update: TextInput20_14.Text`; **GARANTIA** — `Update: TextInput20_25.Text` / `Update: TextInput20_18.Text`; **IDCONTRATO** — `Update: ComboBox47_1.Selected.ID` / `Update: ComboBox47.Selected.ID`; **IDESTIMATIVA** — `Update: ComboBox47_3.Selected.ID` / `Update: ComboBox47_2.Selected.ID`; **LOCALSERVICO** — `Update: TextInput20_19.Text` / `Update: TextInput20_4.Text`; **OBRIGACOESCONTRATADO** — `Update: TextInput20_15.Text`; **PENALIDADES** — `Update: TextInput20_24.Text` / `Update: TextInput20_17.Text`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `With( { atividadePadrao: LookUp( FORNECEDORES, CADASTRO = ComboBox42_4.Selected.CADASTRO, 'ATIVIDADE EXERCIDA' ) }, If( IsBlank(atividadePadrao), // caso não tenha atividade exercida cadastrada → só filtra pela filial Filter( 'ATIVIDADE EXECUTADA', FILIAL = DataCardValue175_1.Selected.FILIAL ), // caso tenha atividade exercida If( !IsBlank( LookUp( 'ATIVIDADE EXECUTADA', 'ATIVIDADE EXECUTADA' = atividadePadrao && FI…` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `With( { atividadePadrao: LookUp( FORNECEDORES, CADASTRO = ComboBox42_1.Selected.CADASTRO, 'ATIVIDADE EXERCIDA' ) }, If( IsBlank(atividadePadrao), // caso não tenha atividade exercida cadastrada → só filtra pela filial Filter( 'ATIVIDADE EXECUTADA', FILIAL = ComboBox42_51.Selected.FILIAL ), // caso tenha atividade exercida If( !IsBlank( LookUp( 'ATIVIDADE EXECUTADA', 'ATIVIDADE EXECUTADA' = atividadePadrao && FILIAL …` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **CONTRATO** | `Classic/DropDown` | `["ASSINADO","PENDENTE ASSINATURA"]` | `—` | `não declarado` | `não declarado` |
| **CONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( DOCUMENTOS_1, TIPOHOMOLOGACAO = "HOMOLOGAÇÃO CONTRATO", TIPODOCUMENTO = "CONTRATO ASSINADO", PESSOARELACIONADA = ComboBox42_4.Selected.CADASTRO ), EXIBICAO, Text(ID) & " - " & Coalesce(PESSOARELACIONADA, "") & " (" & TIPODOCUMENTO & ")" ), "ID", SortOrder.Descending )` | `["EXIBICAO"]` | `não declarado` | `false` |
| **CONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( DOCUMENTOS_1, TIPOHOMOLOGACAO = "HOMOLOGAÇÃO CONTRATO", TIPODOCUMENTO = "CONTRATO ASSINADO", PESSOARELACIONADA = ComboBox42_1.Selected.CADASTRO ), EXIBICAO, Text(ID) & " - " & Coalesce(PESSOARELACIONADA, "") & " (" & TIPODOCUMENTO & ")" ), "ID", SortOrder.Descending )` | `["EXIBICAO"]` | `não declarado` | `não declarado` |
| **DESCRITIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = DataCardValue175_1.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **DESCRITIVOETAPA** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = ComboBox42_51.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & FORNECEDOR & "- " & IMOVEL& ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **ETAPA OBRA** | `Classic/ComboBox` | `LANCAMENTOOBRA.ETAPA` | `["field_3"]` | `não declarado` | `false` |
| **ETAPA OBRA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = ComboBox42_51.Selected.FILIAL, STATUS="INICIADO"), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, EMPREITEIRO = "SIM" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, EMPREITEIRO = "SIM", STATUS="ATIVO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO DE MEDIÇÃO** (`TIPODEMEDI_x00c7__x00c3_O`) | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( DOCUMENTOS_1, TIPOHOMOLOGACAO = "HOMOLOGAÇÃO CONTRATO", TIPODOCUMENTO = "ESTIMATIVA DE CUSTO FINANCEIRO", PESSOARELACIONADA = ComboBox42_4.Selected.CADASTRO ), EXIBICAO, Text(ID) & " - " & Coalesce(PESSOARELACIONADA, "") & " (" & TIPODOCUMENTO & ")" ), "ID", SortOrder.Descending )` | `["APROVADO"]` | `não declarado` | `false` |
| **TIPO DE MEDIÇÃO** (`TIPODEMEDI_x00c7__x00c3_O`) | `Classic/DropDown` | `["MEDIÇÃO VALOR GLOBAL","MEDIÇÃO VALOR UNITÁRIO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO DE MEDIÇÃO** (`TIPODEMEDI_x00c7__x00c3_O`) | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( DOCUMENTOS_1, TIPOHOMOLOGACAO = "HOMOLOGAÇÃO CONTRATO", TIPODOCUMENTO = "ESTIMATIVA DE CUSTO FINANCEIRO", PESSOARELACIONADA = ComboBox42_1.Selected.CADASTRO ), EXIBICAO, Text(ID) & " - " & Coalesce(PESSOARELACIONADA, "") & " (" & TIPODOCUMENTO & ")" ), "ID", SortOrder.Descending )` | `["EXIBICAO"]` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 10 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 7 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### FILIAIS

- **Entidade no portal:** Filiais (`filiais`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `EDITARFORNECEDOR_1` — `E4- EDITAR FILIAL.pa.yaml`; `Form3` — `F11- CADASTRO FILIAL.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CIDADE**, **FILIAL** (`Title`), **STATUS**, **UN** (`field_1`), **VALORVISITA**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CIDADE** | `Classic/DropDown` | `CADASTROCIDADE.Title` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### FORMAPGTO LOCACAO

- **Entidade no portal:** Formas de pagamento de locação (`formas-de-pagamento-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form41` — `Screen3.pa.yaml`.
- **Campos visíveis:** **FORMAPGTO**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### FORNECEDORES

- **Entidade no portal:** Fornecedores (`fornecedores`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 3 ocorrência(s) de `Patch`.
- **Formulários:** `EDITARFORNECEDOR` — `E2- EDITAR FORNECEDOR.pa.yaml`; `Form2` — `F10- CADASTRO FORNECEDOR.pa.yaml`; `Form2_1` — `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `EDITARFORNECEDOR_3` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ATIVIDADE EXERCIDA** (`field_2`), **CADASTRO** (`Title`), **CIDADE** (`field_5`), **DESCRITIVOETAPA ATUAL**, **DOCUMENTO FORNECEDOR**, **E-MAIL** (`field_4`), **EMAIL**, **EMPREITEIRO**, **ENDEREÇO** (`field_6`), **FILIAL**, **FORMA PGTO**, **HOMOLOGACAO**, **IMOVEL**, **PROFISSAO**, **STATUS**, **TELEFONE** (`field_3`), **TELEFONECONTATO**, **TIPO** (`field_1`), **TIPODOCUMENTO**, **WHATSAPP**.
- **Campos condicionais:** **ATIVIDADE EXERCIDA** (`field_2`) — `Visible: If(DataCardValue179.Selected.Value="SIM",true,false)`; **DATANASCIMENTO** — `Visible: DataCardValue148.Selected.TIPO="MÃO DE OBRA"` / `Visible: DataCardValue140.Selected.TIPO="MÃO DE OBRA"`; **DESCRITIVOETAPA ATUAL** — `Visible: If(DataCardValue182.Selected.Value="SIM",true,false)` / `Visible: '=If(DataCardValue179.Selected.Value="SIM",true,false) '`; **EMPREITEIRO** — `Visible: DataCardValue140.Selected.TIPO="MÃO DE OBRA"`; **FORMA PGTO** — `Visible: If(DataCardValue182.Selected.Value="SIM",true,false)` / `Visible: If(DataCardValue179.Selected.Value="SIM",true,false)`; **HORASTRABALHO** — `Visible: DataCardValue182.Selected.Value="SIM"` / `Visible: DataCardValue396.Selected.Value="DIÁRIA"` / `Visible: DataCardValue396_4.Selected.Value="DIÁRIA"`; **IMOVEL** — `Visible: If(DataCardValue179.Selected.Value="SIM",true,false) && DataCardValue396.Selected.Value="MEDIÇÃO" \|\| DataCardValue396.Selected.Value="DIÁRIA"\|\| DataCardValue396.Selected.Value="VALOR GLOBAL"`; **MEDIÇÃOATUAL** (`MEDI_x00c7__x00c3_OATUAL`) — `Visible: If(DataCardValue396_1.Selected.Value="MEDIÇÃO",true,false)` / `Visible: If( DataCardValue179.Selected.Value="SIM" && (DataCardValue396.Selected.Value="MEDIÇÃO" \|\| DataCardValue396.Selected.Value="VALOR GLOBAL"), true, false )` / `Visible: If(DataCardValue396_4.Selected.Value="MEDIÇÃO" \|\| DataCardValue396_4.Selected.Value="VALOR GLOBAL",true,false)`; **PROFISSAO** — `Visible: If(DataCardValue148.Selected.TIPO="MÃO DE OBRA",true,false)` / `Visible: If(DataCardValue179.Selected.Value="SIM",true,false)`; **VLR DIARIO** — `Visible: If(DataCardValue396_1.Selected.Value="DIÁRIA",true,false)` / `Visible: If(DataCardValue179.Selected.Value="SIM",true,false) && DataCardValue396.Selected.Value="DIÁRIA"` / `Visible: If(DataCardValue396_4.Selected.Value="DIÁRIA",true,false)`.
- **Campos calculados/forçados:** **ATIVIDADE EXERCIDA** (`field_2`) — `Update: Concat(ComboBox49_1.SelectedItems, 'ATIVIDADE EXECUTADA' & " ")`; **ENDEREÇO** (`field_6`) — `Update: Upper(Value(DataCardValue144.Text))` / `Update: Upper(Value(DataCardValue133.Text))` / `Update: Upper(Value(DataCardValue133_1.Text))`.
- **Campos gravados por Patch:** `ATIVIDADE EXERCIDA`, `DESCRITIVOETAPA ATUAL`, `FORMA PGTO`, `IMOVEL`, `MEDIÇÃOATUAL`, `STATUS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADE EXERCIDA** (`field_2`) | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADE EXERCIDA** (`field_2`) | `Classic/ComboBox` | `Filter('ATIVIDADE EXECUTADA',FILIAL=ComboBox8.Selected.FILIAL,ETAPA=LookUp(DEMONSTRATIVOETAPA,ID=ComboBox42_102.Selected.ID,ETAPA))` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **ATIVIDADE EXERCIDA** (`field_2`) | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `múltipla pela fórmula` |
| **ATIVIDADE EXERCIDA** (`field_2`) | `Classic/ComboBox` | `Filter('ATIVIDADE EXECUTADA',FILIAL=DataCardValue145_2.Selected.FILIAL,ETAPA=LookUp(DEMONSTRATIVOETAPA,ID=ComboBox42_152.Selected.ID,ETAPA))` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **CIDADE** (`field_5`) | `Classic/DropDown` | `CADASTROCIDADE.Título` | `—` | `não declarado` | `não declarado` |
| **DESCRITIVOETAPA ATUAL** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = DataCardValue145.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " &ATIVIDADEEXECUTADA & " (" & IMOVEL & " - " & FORNECEDOR & ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **DESCRITIVOETAPA ATUAL** | `Classic/ComboBox` | `AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = ComboBox8.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " &ATIVIDADEEXECUTADA & " (" & IMOVEL & " - " & FORNECEDOR & ")" )` | `["Exibir"]` | `não declarado` | `false` |
| **DESCRITIVOETAPA ATUAL** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( DEMONSTRATIVOETAPA, FILIAL = DataCardValue145_2.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), Exibir, ID & " - " & ATIVIDADEEXECUTADA & " (" & IMOVEL & " - " & FORNECEDOR & ")" ), "ATIVIDADEEXECUTADA", SortOrder.Ascending )` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **EMPREITEIRO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORMA PGTO** | `Classic/DropDown` | `["MEDIÇÃO","DIÁRIA","VALOR GLOBAL"]` | `—` | `não declarado` | `não declarado` |
| **HOMOLOGACAO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = DataCardValue145.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = ComboBox8.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter(DEMONSTRATIVOETAPA, FILIAL = DataCardValue145_2.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **MEDIÇÃOATUAL** (`MEDI_x00c7__x00c3_OATUAL`) | `Classic/ComboBox` | `AddColumns( Filter( EMPREITEIRO, STATUS="ATIVO" ), Exibir, ID & " - " & FORNECEDOR )` | `["Exibir"]` | `não declarado` | `false` |
| **MEDIÇÃOATUAL** (`MEDI_x00c7__x00c3_OATUAL`) | `Classic/ComboBox` | `AddColumns( Filter( EMPREITEIRO, STATUS="ATIVO", FILIAL=ComboBox8.Selected.FILIAL ), Exibir, ID & " - " & FORNECEDOR )` | `["Exibir"]` | `não declarado` | `false` |
| **MEDIÇÃOATUAL** (`MEDI_x00c7__x00c3_OATUAL`) | `Classic/ComboBox` | `AddColumns(Filter(EMPREITEIRO,STATUS="ATIVO"),Exibir,ID&" - "&FORNECEDOR & " - " & ATIVIDADEEXECUTADA)` | `["Exibir"]` | `não declarado` | `false` |
| **PROFISSAO** | `Classic/ComboBox` | `Filter(PROFISSÃO,STATUS="ATIVO").PROFISSÃO` | `["PROFISS_x00c3_O"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO** (`field_1`) | `Classic/DropDown` | `CADASTROTIPOMATERIAL.TIPO` | `—` | `não declarado` | `não declarado` |
| **TIPO** (`field_1`) | `Classic/DropDown` | `Filter( CADASTROTIPOMATERIAL, STATUS = "ATIVO" ).TIPO` | `—` | `não declarado` | `não declarado` |
| **TIPODOCUMENTO** | `Classic/ComboBox` | `Filter( 'CADASTRO TIPO DOCUMENTO', HOMOLOGAÇÃO = "HOMOLOGAÇÃO MÃO DE OBRA" ).TIPODOCUMENTO` | `["TIPODOCUMENTO"]` | `não declarado` | `false` |
| **WHATSAPP** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 10 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 2 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 14 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 7 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- 1 campo(s) agregam múltiplas seleções; lookup/person múltiplo é deliberadamente não resolvível no formulário atual.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### FORNECEDORLOCACAO

- **Entidade no portal:** Fornecedores de locação (`fornecedores-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form49_1` — `DESPESAS RECORRENTES LOCAÇÃO.pa.yaml`; `EDITARGRUPO_21` — `HISTÓRICO FORNECEDORES.pa.yaml`; `Form49` — `PREVISTO LOCAÇÕES E IARA.pa.yaml`; `Form51` — `Screen1.pa.yaml`.
- **Campos visíveis:** **FORNECEDOR**, **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### FUNCAOIMOBILIZADO

- **Entidade no portal:** Funções de imobilizado (`funcoes-de-imobilizado`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form22` — `F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml`.
- **Campos visíveis:** **FUNCAO**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### GRUPO IMOBILIZADOS

- **Entidade no portal:** Grupos de imobilizados (`grupos-de-imobilizados`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_46` — `F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml`; `Form1_37` — `F19- CADASTROGRUPOIMOBILIZADO.pa.yaml`; `Form15_1` — `G13- HISTÓRICOGRUPOIMOBILIZADO.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **GRUPOIMOBILIZADOS**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### GRUPODOCFILIAL

- **Entidade no portal:** Grupos de documentos por filial (`grupos-de-documentos-por-filial`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form32_1` — `G45- HISTÓRICO GRUPO.pa.yaml`; `Form34` — `G45- HISTÓRICO GRUPO.pa.yaml`; `Form35` — `G45- HISTÓRICO GRUPO.pa.yaml`; `Form26` — `I8- GERAL AUDITORIA.pa.yaml`.
- **Campos visíveis:** **GRUPO**, **HOMOLOGA_x00c7__x00c3_O**, **Title**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **HOMOLOGA_x00c7__x00c3_O** | `Classic/DropDown` | `["HOMOLOGAÇÃO MÃO DE OBRA","HOMOLOGAÇÃO FILIAL","HOMOLOGAÇÃO CONTRATO"]` | `—` | `não declarado` | `não declarado` |
| **HOMOLOGA_x00c7__x00c3_O** | `Classic/DropDown` | `["HOMOLOGAÇÃO MÃO DE OBRA","HOMOLOGAÇÃO FILIAL","HOMOLOGAÇÃO CONTRATO","HOMOLOGAÇÃO COMERCIAL","HOMOLOGAÇÃO ETAPA OBRA"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### HOMOLOGARFORNECEDOR

- **Entidade no portal:** Homologações de fornecedor (`homologacoes-de-fornecedor`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 0 formulário(s), 0 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Campos gravados por Patch:** `APROVADO`, `COBRAR`, `COMPRIMIR`, `DATA`, `FILIAL`, `FORNECEDOR`, `STATUS`, `TIPODOCUMENTO`.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 8 campo(s) só aparecem em `Patch` (`APROVADO`, `COBRAR`, `COMPRIMIR`, `DATA`, `FILIAL`, `FORNECEDOR`, `STATUS`, `TIPODOCUMENTO`); seus defaults/regras não são executados pelo formulário genérico.

### HOMOLOGARLOCACAO

- **Entidade no portal:** Homologações de locação (`homologacoes-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form39_2` — `Screen4_1.pa.yaml`; `Form39_3` — `Screen4_1.pa.yaml`; `Form40` — `Screen4_1.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CONTRATO**, **DESCRICAO**, **GRUPO**, **INQUILINO**, **STATUS**, **TIPO**.
- **Campos gravados por Patch:** `CONTRATO`, `DESCRICAO`, `GRUPO`, `IDPGTO`, `INQUILINO`, `STATUS`, `TIPO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CONTRATO** | `Classic/ComboBox` | `AddColumns( 'CADASTRO ALUGUEL', ID_DESCRICAO, Text(ID) & " - " & DESCRICAOIMOVEL & " (" & INQUILINO & ")" )` | `["ID_DESCRICAO"]` | `não declarado` | `false` |
| **DESCRICAO** | `Classic/ComboBox` | `CADASTROIMOVEL.DESCRICAO` | `["DESCRICAO"]` | `não declarado` | `false` |
| **GRUPO** | `Classic/ComboBox` | `CADASTROGRUPOIMÓVEL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **INQUILINO** | `Classic/ComboBox` | `'CADASTRO INQUILINO_1'.'NOME INQUILINO'` | `["NOME"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE","SUBMETIDO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO** | `Classic/ComboBox` | `TIPOHOMOLOGACAOLOCACAO.TIPO` | `["TIPO"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 1 campo(s) só aparecem em `Patch` (`IDPGTO`); seus defaults/regras não são executados pelo formulário genérico.

### IMOBILIZADOS

- **Entidade no portal:** Imobilizados (`imobilizados`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_38` — `F18- CADASTRO LANÇAMENTO IMOBILIZADO.pa.yaml`; `Form16` — `G22- HISTÓRICOLANCAMENTOIMOBILIZADO.pa.yaml`.
- **Campos visíveis:** **% DEPRECIACAO** (`OData__x0025_DEPRECIACAO`), **Anexos** (`{Attachments}`), **CONDIÇÃO** (`CONDI_x00c7__x00c3_O`), **DATA CADASTRO**, **DATA COMPRA**, **DATA DEPRECIAÇÃO** (`DATADEPRECIA_x00c7__x00c3_O`), **DEPRECIAR**, **FILIAL**, **FORNECEDOR**, **FUNÇÃO** (`FUN_x00c7__x00c3_O`), **GRUPO IMOBILIZADO**, **HTML**, **IMOBILIZADO** (`ITEM`), **NÚMEROIMOBILIZADO** (`N_x00da_MEROIMOBILIZADO`), **QTD**, **STATUS**, **VALOR ESTIMADO**, **VALOR RESIDUAL**.
- **Campos gravados por Patch:** `% DEPRECIACAO`, `DATA CADASTRO`, `DATA COMPRA`, `DATA DEPRECIAÇÃO`, `FILIAL`, `FORNECEDOR`, `FUNÇÃO`, `GRUPO IMOBILIZADO`, `IMOBILIZADO`, `NÚMEROIMOBILIZADO`, `QTD`, `VALOR ESTIMADO`, `VALOR RESIDUAL`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CONDIÇÃO** (`CONDI_x00c7__x00c3_O`) | `Classic/DropDown` | `["APLICADO EM OBRA","OCIOSO EM SEDE","IRRECUPERÁVEL","EXTRAVIADO"]` | `—` | `não declarado` | `não declarado` |
| **DEPRECIAR** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **FUNÇÃO** (`FUN_x00c7__x00c3_O`) | `Classic/ComboBox` | `FUNCAOIMOBILIZADO.FUNCAO` | `["FUNCAO"]` | `não declarado` | `false` |
| **GRUPO IMOBILIZADO** | `Classic/ComboBox` | `'GRUPO IMOBILIZADOS'.GRUPOIMOBILIZADOS` | `["GRUPOIMOBILIZADOS"]` | `não declarado` | `false` |
| **IMOBILIZADO** (`ITEM`) | `Classic/ComboBox` | `CADASTROIMOBILIZADO.IMOBILIZADO` | `["IMOBILIZADO"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### IMOVEL CADASTRADO

- **Entidade no portal:** Imóveis (`imoveis`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_30` — `F26- CADASTRO IMÓVEL.pa.yaml`; `EDITARGRUPO_23` — `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `EDITARGRUPO_14` — `G15- HISTÓRICO IMÓVEIS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CONTRATO**, **CORRETAGEM**, **CORRETOR**, **DESCRITIVO CORRETAGEM**, **FILIAL**, **FISCAL**, **IDCONTRATOCAIXA**, **IDDOCFISCAL**, **IDDOCUMENTOCORRETAGEM**, **IDESCRITURA**, **IDPGTOCORRETAGEM**, **IDPGTOFISCAL**, **IDPROPOSTA**, **IDPROV**, **IMOVEL**, **NF/RECIBO** (`NF_x002f_RECIBO`), **OBS FISCAL**, **SEGURO**, **STATUS**, **STATUSVISUAL**, **VLORCORRETAGEM**, **VLORFISCAL**.
- **Campos calculados/forçados:** **CONTRATO** — `Update: If( IsEmpty(ComboBox19_3.SelectedItems), Blank(), Concat( ComboBox19_3.SelectedItems, Text(ID), ", " ) )`; **IDCONTRATOCAIXA** — `Update: If( IsEmpty(ComboBox46_2.SelectedItems), Blank(), Concat( ComboBox46_2.SelectedItems, Text(ID), ", " ) )`; **IDDOCFISCAL** — `Update: If( IsEmpty(ComboBox45_6.SelectedItems), Blank(), Concat( ComboBox45_6.SelectedItems, Text(ID), ", " ) )`; **IDDOCUMENTOCORRETAGEM** — `Update: If( IsEmpty(ComboBox45_2.SelectedItems), Blank(), If( CountIf( ComboBox45_2.SelectedItems, Trim(Text(ID)) = "0" ) > 0, "DISPENSADO", Concat( Filter( ComboBox45_2.SelectedItems, !IsBlank(ID) && Trim(Text(ID)) <> …`; **IDESCRITURA** — `Update: If( IsEmpty(ComboBox46.SelectedItems), Blank(), Concat( ComboBox46.SelectedItems, Text(ID), ", " ) )`; **IDPGTOCORRETAGEM** — `Update: If( IsEmpty(ComboBox45.SelectedItems), Blank(), If( CountIf( ComboBox45.SelectedItems, ID = 0 ) > 0, "DISPENSADO", Concat( Filter( ComboBox45.SelectedItems, !IsBlank(ID) && ID <> 0 ), Text(ID), ", " ) ) )`; **IDPGTOFISCAL** — `Update: If( IsEmpty(ComboBox45_5.SelectedItems), Blank(), Concat( ComboBox45_5.SelectedItems, Text(ID), ", " ) )`; **IDPROPOSTA** — `Update: If( IsEmpty(ComboBox46_1.SelectedItems), Blank(), Concat( ComboBox46_1.SelectedItems, Text(ID), ", " ) )`; **SEGURO** — `Update: If( IsEmpty(ComboBox46_3.SelectedItems), Blank(), If( CountIf( ComboBox46_3.SelectedItems, Upper(Trim(Exibir)) = "DISPENSADO" \|\| ID = 0 ) > 0, "DISPENSADO", Concat( ComboBox46_3.SelectedItems, Text(ID), ", " ) )…`; **VLORCORRETAGEM** — `Update: TextInput8_1.Text`; **VLORFISCAL** — `Update: TextInput8.Text`.
- **Campos gravados por Patch:** `STATUS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( Filter( LANCAMENTOCOMPRAS, FILIAL = DataCardValue251_1.Selected.FILIAL ), Exibir, Text(ID) & " - " & NOME & " - " & If( IsBlank(MOTIVOBAIXA), "CONTRATO ATIVO", MOTIVOBAIXA ) ), "ID", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `múltipla pela fórmula` |
| **CORRETAGEM** | `Classic/DropDown` | `["PENDENTE","PAGO EMPRESA","PAGO CLIENTE","VENDA DIRETA"]` | `—` | `não declarado` | `não declarado` |
| **CORRETAGEM** | `Classic/ComboBox` | `If( DataCardValue493_1.Selected.Value = "PAGO CLIENTE", AddColumns( Filter( LANÇAMENTORECEITA, PRODUTO = "PAGAMENTO CORRETOR" ), ValorCombo, "PAGO CLIENTE - " & Text(ID) & " - " & FORNECEDOR & " (R$ " & Text( VALORTOTAL, "[$-pt-BR]#.##0,00" ) & ")" ), AddColumns( Filter( LANCAMENTOS, PRODUTO = "CORRETAGEM DE VENDA CASA" ), ValorCombo, Text(ID) & " - " & FORNECEDOR & " (" & Text(DATA, "dd/mm/yyyy") & ") - R$ " & Text…` | `["ComplianceAssetId"]` | `não declarado` | `não declarado` |
| **CORRETOR** | `Classic/ComboBox` | `CORRETOR` | `["CIDADE"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **FISCAL** | `Classic/DropDown` | `["NÃO DECLARADO","DECLARADO"]` | `—` | `não declarado` | `não declarado` |
| **IDPGTOFISCAL** | `Classic/ComboBox` | `AddColumns( Filter( LANCAMENTOS, FILIAL = DataCardValue251_1.Selected.FILIAL, PRODUTO = "IMPOSTO SOBRE GANHOS DE CAPITAL" ), Exibir, Text(ID) & " - " & FORNECEDOR & " (" & Text( 'DATA PGTO EFETUADO', "dd/mm/yyyy" ) & ") - R$ " & Text( (QUANTIDADE * 'VALOR UNITÁRIO') + FRETE, "[$-pt-BR]#.##0,00" ) )` | `["Exibir"]` | `não declarado` | `múltipla pela fórmula` |
| **IDPGTOFISCAL** | `Classic/ComboBox` | `AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "DETALHAMENTOS FISCAIS E COMPROVANTES", STATUS="SUBMETIDO" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" )` | `["Exibir"]` | `não declarado` | `múltipla pela fórmula` |
| **IMOVEL** | `Classic/ComboBox` | `AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "MATRÍCULA", STATUS="SUBMETIDO" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" )` | `["Exibir"]` | `não declarado` | `não declarado` |
| **NF/RECIBO** (`NF_x002f_RECIBO`) | `Classic/DropDown` | `["SUBMETIDO","PENDENTE","DISPENSADO"]` | `—` | `não declarado` | `não declarado` |
| **NF/RECIBO** (`NF_x002f_RECIBO`) | `Classic/ComboBox` | `Ungroup( Table( { Itens: Table( { ID: 0, PESSOARELACIONADA: "DISPENSADO", IMOVEL: "", Exibir: "DISPENSADO" } ) }, { Itens: AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "RECIBO E COMPROVANTE DE PAGAMENTO CORRETAGEM", STATUS = "SUBMETIDO" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" ) } ), Itens )` | `["Exibir"]` | `não declarado` | `não declarado` |
| **SEGURO** | `Classic/ComboBox` | `Ungroup( Table( { Itens: Table( { ID: 0, PESSOARELACIONADA: "DISPENSADO", IMOVEL: "", Exibir: "DISPENSADO" } ) }, { Itens: AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "SEGURO RCPM", STATUS = "SUBMETIDO" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" ) } ), Itens )` | `["Exibir"]` | `não declarado` | `múltipla pela fórmula` |
| **STATUS** | `Classic/DropDown` | `["VENDIDO","NÃO VENDIDO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/ComboBox` | `AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "PROPOSTA DE COMPRA E VENDA", STATUS="SUBMETIDO" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" )` | `["Exibir"]` | `não declarado` | `não declarado` |
| **STATUSVISUAL** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **STATUSVISUAL** | `Classic/ComboBox` | `AddColumns( Filter( DOCUMENTOS_1, FILIAL = DataCardValue251_1.Selected.FILIAL, TIPODOCUMENTO = "ESCRITURA TRANSFERÊNCIA OU CONTRATO CAIXA" ), Exibir, Text(ID) & " - " & PESSOARELACIONADA & " (" & IMOVEL & ")" )` | `["Exibir"]` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 11 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 11 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 9 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- 9 campo(s) agregam múltiplas seleções; lookup/person múltiplo é deliberadamente não resolvível no formulário atual.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LANCAMENTOALUGUEL

- **Entidade no portal:** Lançamentos de aluguel (`lancamentos-de-aluguel`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form3_7` — `Screen2.pa.yaml`; `Form10` — `Screen2.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATA VENCIMENTO**, **DATAPGTOEFETUADO**, **DESCRICAO**, **FORMA PGTO**, **IMÓVEL** (`IM_x00d3_VEL`), **INQUILINO**, **NUM_x002e_CONTRATOALUGUEL**, **OBSERVAÇÕES PAGAMENTO** (`OBSERVA_x00c7__x00d5_ESPAGAMENTO`), **STATUS**, **VALOR BRUTO**.
- **Campos gravados por Patch:** `DATA VENCIMENTO`, `DESCRICAO`, `FORMA PGTO`, `IMÓVEL`, `INQUILINO`, `OBSERVAÇÕES PAGAMENTO`, `STATUS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **DESCRICAO** | `Classic/ComboBox` | `CADASTROIMOVEL.DESCRICAO` | `["DESCRICAO"]` | `não declarado` | `false` |
| **DESCRICAO** | `Classic/ComboBox` | `CADASTROIMOVEL` | `["DESCRICAO"]` | `não declarado` | `false` |
| **FORMA PGTO** | `Classic/DropDown` | `["PIX- BERNARDO","DINHEIRO","PIX - AMAEL", "ESA","GEISA"]` | `—` | `não declarado` | `não declarado` |
| **FORMA PGTO** | `Classic/DropDown` | `'FORMAPGTO LOCACAO'.FORMAPGTO` | `—` | `não declarado` | `não declarado` |
| **IMÓVEL** (`IM_x00d3_VEL`) | `Classic/ComboBox` | `CADASTROGRUPOIMÓVEL.GRUPO` | `["GRUPO"]` | `não declarado` | `false` |
| **IMÓVEL** (`IM_x00d3_VEL`) | `Classic/DropDown` | `Distinct(CADASTROIMOVEL,IMOVEL)` | `—` | `não declarado` | `não declarado` |
| **INQUILINO** | `Classic/ComboBox` | `'CADASTRO INQUILINO_1'.'NOME INQUILINO'` | `["NOME"]` | `não declarado` | `false` |
| **INQUILINO** | `Classic/ComboBox` | `'CADASTRO ALUGUEL'` | `["INQUILINO"]` | `não declarado` | `false` |
| **NUM_x002e_CONTRATOALUGUEL** | `Classic/ComboBox` | `AddColumns( 'CADASTRO ALUGUEL', ID_DESCRICAO, Text(ID) & " - " & DESCRICAOIMOVEL & " (" & INQUILINO & ")" )` | `["ID_DESCRICAO"]` | `não declarado` | `false` |
| **NUM_x002e_CONTRATOALUGUEL** | `Classic/ComboBox` | `AddColumns( Filter('CADASTRO ALUGUEL',STATUS="ATIVO"), ID_DESCRICAO, Text(ID) & " - " & DESCRICAOIMOVEL & " (" & INQUILINO & ")" )` | `["ID_DESCRICAO"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE PGTO","PAGO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LANCAMENTOCOMPRAS

- **Entidade no portal:** Compras (`compras`).
- **Contrato:** sobrescrita parcial; campos continuam no curinga `*`.
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_35` — `E16- EDITAR CADASTRO VENDA.pa.yaml`; `Form1_31` — `F25- CADASTRO LANCAMENTO VENDA.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CORRETOR**, **CPF**, **DATA VENDA**, **DATAENCERRAMENTO**, **DESCRICAO VENDA**, **FILIAL**, **IMOVEL**, **NOME**, **RG**, **STATUS**, **TELEFONE**, **TOTAL**.
- **Campos condicionais:** **MOTIVOBAIXA** — `Visible: DataCardValue227_6.Selected.Value="INATIVO"`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CORRETOR** | `Classic/ComboBox` | `CORRETOR.NOMECORRETORA` | `["NOMECORRETORA"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `'IMOVEL CADASTRADO'.IMOVEL` | `["IMOVEL"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter( 'IMOVEL CADASTRADO', FILIAL = ComboBox58.Selected.FILIAL )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **MOTIVOBAIXA** | `Classic/DropDown` | `["DESISTÊNCIA COMPRA","NÃO APROVAÇÃO FINANCIAMENTO","DEMORA CONCLUSÃO OBRA"]` | `—` | `não declarado` | `não declarado` |
| **NOME** | `Classic/ComboBox` | `'CADASTRO CLIENTE_1'.NOME` | `["NOME"]` | `não declarado` | `false` |
| **NOME** | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', STATUS = "ATIVO" )` | `["CORRETOR"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LANCAMENTOOBRA

- **Entidade no portal:** Lançamentos de obras (`lancamentos-de-obras`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Formulários:** `EDITARGRUPO_9` — `E7- EDITAR ETAPA OBRA.pa.yaml`; `Form1_10` — `F24- CADASTRO ETAPA OBRA.pa.yaml`; `EDITARGRUPO_16` — `G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **DATA FATAL**, **ETAPA** (`field_3`), **FILIAL**, **FIM** (`field_5`), **ID**, **INÍCIO** (`field_4`), **PERCENTUALEFETUADO**, **STATUS**, **TIPO** (`field_2`).
- **Campos calculados/forçados:** **PERCENTUALEFETUADO** — `Update: ComboBox94_1.Selected.Value/100` / `Update: ComboBox94_5.Selected.Value/100`.
- **Campos gravados por Patch:** `ETAPA`, `FILIAL`, `FIM`, `INÍCIO`, `STATUS`, `TIPO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FIM** (`field_5`) | `Classic/DropDown` | `["00","01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48","49","50","51","52","53","54","55","56","57","58","59"]` | `—` | `não declarado` | `não declarado` |
| **INÍCIO** (`field_4`) | `Classic/DropDown` | `["00","01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25","26","27","28","29","30","31","32","33","34","35","36","37","38","39","40","41","42","43","44","45","46","47","48","49","50","51","52","53","54","55","56","57","58","59"]` | `—` | `não declarado` | `não declarado` |
| **PERCENTUALEFETUADO** | `Classic/ComboBox` | `[ {Value: "0"}, {Value: "1"}, {Value: "2"}, {Value: "3"}, {Value: "4"}, {Value: "5"}, {Value: "6"}, {Value: "7"}, {Value: "8"}, {Value: "9"}, {Value: "10"}, {Value: "11"}, {Value: "12"}, {Value: "13"}, {Value: "14"}, {Value: "15"}, {Value: "16"}, {Value: "17"}, {Value: "18"}, {Value: "19"}, {Value: "20"}, {Value: "21"}, {Value: "22"}, {Value: "23"}, {Value: "24"}, {Value: "25"}, {Value: "26"}, {Value: "27"}, {Value:…` | `["Value"]` | `não declarado` | `false` |
| **TIPO** (`field_2`) | `Classic/DropDown` | `["ATIVIDADE COMUM","ATIVIDADE FANTASMA"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 5 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 2 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LANÇAMENTORECEITA

- **Entidade no portal:** Receitas (`receitas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Formulários:** `Form33` — `F44- LANÇAMENTO RECEITA.pa.yaml`; `Form7_2` — `G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml`; `Form8_1` — `G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml`; `Form33_1` — `G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ASSINATURA**, **CONTA**, **DATA**, **DATAPGTOEFETUADO**, **DATAPGTOPREVISTO**, **DESCRIÇÃO** (`DESCRI_x00c7__x00c3_O`), **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **IDCONTRATO**, **IMOVEL**, **PRODUTO**, **STATUS**, **TIPO**, **VALORTOTAL**.
- **Campos condicionais:** **PGTO DIR. CORRETOR** (`PGTODIR_x002e_CORRETOR`) — `Visible: DataCardValue7_3.Selected.CONTA= "CONTA BANCÁRIA DE TERCEIRO"` / `Visible: DataCardValue76.Selected.CONTA="CONTA BANCÁRIA DE TERCEIRO"`.
- **Campos calculados/forçados:** **ASSINATURA** — `Update: VARASSINATURA`.
- **Campos gravados por Patch:** `CONTA`, `DATA`, `DATAPGTOPREVISTO`, `DESCRIÇÃO`, `FILIAL`, `FORMAPGTO`, `FORNECEDOR`, `IDCONTRATO`, `IMOVEL`, `PRODUTO`, `QUANTIDADE`, `STATUS`, `VALORTOTAL`, `VALORUNITÁRIO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CONTA** | `Classic/DropDown` | `CADASTROCONTA.CONTA` | `—` | `não declarado` | `não declarado` |
| **DATA** | `Classic/DropDown` | `["LANÇADO HOJE","LANÇADO E PGTO PREVISTO HOJE","LANÇADO, PGTO PREVISTO E PAGO HOJE"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `Filter(FILIAIS,STATUS="ATIVO")` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/DropDown` | `["PIX","DINHEIRO","BOLETO","DEPÓSITO BANCÁRIO"]` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_1.Selected.FILIAL )` | `["NOME"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_4.Selected.FILIAL )` | `["NOME"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( LANCAMENTOCOMPRAS, Exibir, ID & " - " & NOME ), "IDCONTRATO", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( LANCAMENTOCOMPRAS, Exibir, ID & " - " & NOME ), "ID", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_1.Selected.FILIAL ), 'IMÓVEL ADQUIRIDO' )` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_4.Selected.FILIAL ), 'IMÓVEL ADQUIRIDO' )` | `["Value"]` | `não declarado` | `false` |
| **PGTO DIR. CORRETOR** (`PGTODIR_x002e_CORRETOR`) | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **PRODUTO** | `Classic/ComboBox` | `Filter( CADASTROPRODUTO, STATUS = "ATIVO", TIPO="RECEITA" ).PRODUTO` | `["field_1"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 9 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 2 campo(s) só aparecem em `Patch` (`QUANTIDADE`, `VALORUNITÁRIO`); seus defaults/regras não são executados pelo formulário genérico.

### LANCAMENTOS

- **Entidade no portal:** Lançamentos (`lancamentos`).
- **Contrato:** explícito (27 declarações de campo).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 8 ocorrência(s) de `Patch`.
- **Formulários:** `EDITARLANCAMENTO` — `E1- EDITAR LANÇAMENTO COMPRA.pa.yaml`; `FORMULÁRIO LANÇAMENTO` — `F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml`; `Form7` — `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`; `Form5_1` — `G1- HISTÓRICO LANÇAMENTOS.pa.yaml`.
- **Campos visíveis:** **ACUMULADO**, **ADIANTAMENTO**, **AGRUPAR**, **Anexos** (`{Attachments}`), **APROVACAO**, **CONCLUÍDO** (`field_19`), **CONTA** (`field_14`), **DATA** (`field_2`), **DATA PGTO EFETUADO** (`field_4`), **DATA PGTO PREVISTO** (`field_3`), **DATA RMS**, **DESCRIÇÃO** (`field_16`), **ETAPA** (`field_6`), **FILIAL** (`Title`), **FORNECEDOR** (`field_5`), **FRETE** (`field_10`), **GERADESEMBOLSO**, **MEDICAOPARCIAL**, **NOTA**, **OBSERVAÇÕES ENTREGA** (`OBSERVA_x00c7__x00d5_ESENTREGA`), **PRODUTO** (`field_7`), **QUANTIDADE** (`field_8`), **TIPO DESPESA**, **TIPO TRANSAÇÃO** (`field_1`), **UN**, **VALOR UNITÁRIO** (`field_9`).
- **Campos condicionais:** **Anexos** (`{Attachments}`) — `Visible: arquivos`; **ASSINATURA** — `Visible: MOSTRARASSINATURA`; **CONTRATO** — `Visible: LookUp(CADASTROPRODUTO,PRODUTO=ComboBox1_2.Selected.PRODUTO,TIPODESPESA="MÃO DE OBRA")` / `Visible: LookUp(FORNECEDORES,CADASTRO=ComboBox9.Selected.CADASTRO,'FORMA PGTO')="MEDIÇÃO"`; **MEDICAOPARCIAL** — `Visible: LookUp(CADASTROPRODUTO,PRODUTO=ComboBox1_2.Selected.PRODUTO,TIPODESPESA="MÃO DE OBRA")`.
- **Campos calculados/forçados:** **AGRUPAR** — `Update: If(Checkbox18.Value, DataCardValue248_1.Text, varUltimoIDNotasPendentes )`; **APROVACAO** — `Update: "PENDENTE DE APROVAÇÃO"`; **ASSINATURA** — `Update: VARASSINATURA`; **MEDICAOPARCIAL** — `Update: ComboBox42_141.Selected.ID` / `Update: ComboBox42_89.Selected.ID`; **UN** — `Update: ComboBox26_8.Selected.'UNIDADE MEDIDA'` / `Update: ComboBox26.Selected.'UNIDADE MEDIDA'`.
- **Campos gravados por Patch:** `AGRUPAR`, `APROVACAO`, `CONCLUÍDO`, `CONTA`, `CONTRATO`, `DATA`, `DATA PGTO EFETUADO`, `DATA PGTO PREVISTO`, `DATA RMS`, `DESCRIÇÃO`, `ETAPA`, `FILIAL`, `FORNECEDOR`, `FRETE`, `GERADESEMBOLSO`, `ID 2`, `IDPGTOAGENDADO`, `NOTA`, `PRODUTO`, `QUANTIDADE`, `TIPO DESPESA`, `TIPO TRANSAÇÃO`, `VALOR UNITÁRIO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **AGRUPAR** | `Classic/DropDown` | `["EMPENHADO HOJE","EMPENHADO E LIQUIDADO HOJE","LIQUIDADO HOJE","LIQUIDADO E PAGO HOJE","EMPENHADO, LIQUIDADO E PAGO HOJE","PAGO HOJE"]` | `—` | `não declarado` | `não declarado` |
| **AGRUPAR** | `Classic/DropDown` | `["RMS CRIADA","COMPRA EMPENHADA","COMPRA LIQUIDADA","COMPRA PAGA"]` | `—` | `não declarado` | `não declarado` |
| **CONTA** (`field_14`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **CONTRATO** | `Classic/ComboBox` | `"=AddColumns( Sort(DESCRICAOMEDICOES,ID,SortOrder.Descending), Exibir, ID & \" - \" & FORNECEDOR & \" (IDCONTRATO - \" & NUMEROCONTRATO &\")\" ) "` | `["ASSINATURA"]` | `não declarado` | `false` |
| **CONTRATO** | `Classic/ComboBox` | `AddColumns( Filter( DESCRICAOMEDICOES, STATUS="ATIVO" ), Exibir, ID & " - " & FORNECEDOR & " (IDCONTRATO - " & NUMEROCONTRATO &")" )` | `["Exibir"]` | `não declarado` | `false` |
| **ETAPA** (`field_6`) | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_1.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** (`field_6`) | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** (`Title`) | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** (`field_5`) | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **GERADESEMBOLSO** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter(CADASTROPRODUTO,STATUS="ATIVO").PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter( CADASTROUNIDADEMEDIDA, STATUS = "ATIVO" )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **PRODUTO** (`field_7`) | `Classic/ComboBox` | `Filter( CADASTROPRODUTO, STATUS = "ATIVO", TIPO="DESPESA" ).PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **TIPO DESPESA** | `Classic/ComboBox` | `Filter( CADASTROTIPOMATERIAL, STATUS = "ATIVO" ).TIPO` | `["Title"]` | `não declarado` | `false` |
| **TIPO TRANSAÇÃO** (`field_1`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- 4 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 5 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 6 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 2 campo(s) só aparecem em `Patch` (`ID 2`, `IDPGTOAGENDADO`); seus defaults/regras não são executados pelo formulário genérico.

### LANCAMENTOS AUDITORIA

- **Entidade no portal:** Auditorias (`auditorias`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form30` — `I8- GERAL AUDITORIA.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **DATAFINALIZA_x00c7__x00c3_O**, **DATALIMITE**, **INCONSISTENCIA**, **STATUS**, **TIPO**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["PENDENTE","INICIADO","FINALIZADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LANCAMENTOTAREFAS

- **Entidade no portal:** Lançamentos de tarefas (`lancamentos-de-tarefas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 9 ocorrência(s) de `Patch`.
- **Formulários:** `FORM.TAREFA_1` — `E11- EDITAR TAREFA.pa.yaml`; `FORM.TAREFA` — `F8- CADASTRO TAREFA.pa.yaml`; `FORM.TAREFA_2` — `G7- HISTÓRICO TAREFAS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **APROVACAO**, **ASSOCIAÇÃO** (`field_10`), **COBRAR**, **CONCLUÍDO** (`field_12`), **DATA CONCLUSÃO** (`field_8`), **DATA FATAL** (`field_7`), **DATA IDENTIFICAÇÃO** (`field_5`), **DATA INÍCIO** (`field_6`), **DIFICULDADE** (`field_3`), **EMAIL**, **FILIAL** (`field_4`), **GRAU URGÊNCIA** (`field_1`), **ID 2** (`ID_x0020_2`), **IMPACTO** (`field_2`), **Nome** (`{Name}`), **OBSERVAÇÕES CONCLUSÃO** (`OBSERVA_x00c7__x00d5_ESCONCLUS_x`), **PRIORITÁRIA** (`PRIORIT_x00c1_RIA`), **REFERENTE**, **TAREFA** (`field_11`), **TIPO** (`field_9`).
- **Campos calculados/forçados:** **DATA INÍCIO** (`field_6`) — `Update: If(IsBlank(DateValue2.SelectedDate),DateValue12.SelectedDate,DateValue2.SelectedDate)`.
- **Campos gravados por Patch:** `DATA FATAL`, `PRIORITÁRIA`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ASSOCIAÇÃO** (`field_10`) | `Classic/ComboBox` | `CADASTROTAREFAS.ASSOCIAÇÃO` | `["field_1"]` | `não declarado` | `false` |
| **ASSOCIAÇÃO** (`field_10`) | `Classic/ComboBox` | `Distinct( Filter(CADASTROTAREFAS, TIPO = "ASSOCIAÇÃO SEDE", STATUS="ATIVO"), ASSOCIAÇÃO )` | `["Value"]` | `não declarado` | `false` |
| **COBRAR** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **DIFICULDADE** (`field_3`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **DIFICULDADE** (`field_3`) | `Classic/DropDown` | `CADASTRODIFICULDADE.Title` | `—` | `não declarado` | `não declarado` |
| **FILIAL** (`field_4`) | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **GRAU URGÊNCIA** (`field_1`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **ID 2** (`ID_x0020_2`) | `Classic/DropDown` | `["ATIVIDADE C/ FATAL HOJE","ATIVIDADE C/ FATAL AMANHÃ","ATIVIDADE C/ FATAL EM 3 DIAS","ATIVIDADE C/ FATAL EM 5 DIAS","ATIVIDADE C/ FATAL EM 10 DIAS","ATIVIDADE C/ FATAL EM 30 DIAS", "ATIVIDADE SEM FATAL DEFINIDO"]` | `—` | `não declarado` | `não declarado` |
| **IMPACTO** (`field_2`) | `Classic/DropDown` | `Parent.AllowedValues` | `—` | `não declarado` | `não declarado` |
| **IMPACTO** (`field_2`) | `Classic/DropDown` | `'CADASTRO IMPACTO'.Title` | `—` | `não declarado` | `não declarado` |
| **PRIORITÁRIA** (`PRIORIT_x00c1_RIA`) | `Classic/DropDown` | `["NÃO PRIORITÁRIA","ATIVIDADE PRIORITÁRIA","ATIVIDADE EMERGENCIAL"]` | `—` | `não declarado` | `não declarado` |
| **REFERENTE** | `Classic/ComboBox` | `Filter( FORNECEDORES, ( FILIAL = "000 - ESCRITÓRIO CENTRAL" && TIPO = "MÃO DE OBRA" && STATUS = "ATIVO" ) \|\| CADASTRO = "BERNARDO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **TIPO** (`field_9`) | `Classic/DropDown` | `["INICIAL","MELHORIA","CORREÇÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 9 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 3 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LINHACONTRATO

- **Entidade no portal:** Linhas de contrato (`linhas-de-contrato`).
- **Contrato:** sobrescrita parcial; campos continuam no curinga `*`.
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form38` — `F46- ADICIONAR LINHA CONTRATO.pa.yaml`; `EDITARGRUPO_18` — `G48 - HISTÓRICO LINHAS CONTRATO.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **ATIVIDADE**, **DATAINICIO**, **DEMONSTRATIVOETAPA**, **DESCRICAO**, **FILIAL**, **FORNECEDOR**, **IDCONTRATO**, **QTD**, **TIPOLINHA**, **TIPOMEDICAO**, **UNIDADE**, **VALORUNITARIO**.
- **Campos gravados por Patch:** `ATIVIDADE`, `DATAINICIO`, `DESCRICAO`, `ETAPA`, `FILIAL`, `FORNECEDOR`, `IDCONTRATO`, `QTD`, `TIPOLINHA`, `TIPOMEDICAO`, `UNIDADE`, `VALORUNITARIO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADE** | `Classic/ComboBox` | `Distinct( Filter( 'ATIVIDADE EXECUTADA', FILIAL=ComboBox42_87.Selected.FILIAL ), 'ATIVIDADE EXECUTADA' )` | `["Value"]` | `não declarado` | `false` |
| **ATIVIDADE** | `Classic/ComboBox` | `'ATIVIDADE EXECUTADA'` | `["ATIVIDADEEXECUTADA"]` | `não declarado` | `false` |
| **DEMONSTRATIVOETAPA** | `Classic/ComboBox` | `AddColumns( Distinct( Filter( DEMONSTRATIVOETAPA, STATUS = "ATIVIDADE INICIADA" ), ETAPA ), Exibir, Value )` | `["Exibir"]` | `não declarado` | `false` |
| **DEMONSTRATIVOETAPA** | `Classic/ComboBox` | `AddColumns( Distinct( Filter( DEMONSTRATIVOETAPA, FILIAL = COMBOBOXFILIAL_8.Selected.FILIAL && STATUS = "ATIVIDADE INICIADA" ), ETAPA ), Exibir, Value // Result = valor distinto )` | `["Exibir"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( EMPREITEIRO, STATUS = "ATIVO" ).FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `AddColumns( Distinct( Filter( EMPREITEIRO, FORNECEDOR = ComboBox42_137.Selected.FORNECEDOR, STATUS = "ATIVO" ), ID ), ID_EMP, Value, DISPLAY, Text(Value) & " - " & LookUp(EMPREITEIRO, ID = Value, FORNECEDOR) )` | `["DISPLAY"]` | `não declarado` | `false` |
| **IDCONTRATO** | `Classic/ComboBox` | `AddColumns( Filter(EMPREITEIRO,STATUS="ATIVO"), Exibicao, Text(ID) & " - " & FORNECEDOR )` | `["ACR_x00c9_SCIMO"]` | `não declarado` | `false` |
| **TIPOLINHA** | `Classic/DropDown` | `["ACRÉSCIMO","ABATIMENTO","RETENÇÃO"]` | `—` | `não declarado` | `não declarado` |
| **TIPOMEDICAO** | `Classic/DropDown` | `["MEDIÇÃO VALOR GLOBAL","MEDIÇÃO VALOR UNITÁRIO"]` | `—` | `não declarado` | `não declarado` |
| **UNIDADE** | `Classic/DropDown` | `CADASTROUNIDADEMEDIDA` | `—` | `não declarado` | `não declarado` |
| **UNIDADE** | `Classic/ComboBox` | `Filter( CADASTROUNIDADEMEDIDA, STATUS = "ATIVO" ).'UNIDADE MEDIDA'` | `["Title"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 6 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### LINHASMEDICAO

- **Entidade no portal:** Linhas de medição (`linhas-de-medicao`).
- **Contrato:** sobrescrita parcial; campos continuam no curinga `*`.
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 3 ocorrência(s) de `Patch`.
- **Formulários:** `Form25` — `F47- ADICIONAR LINHA MEDIÇÃO.pa.yaml`; `EDITARGRUPO_19` — `G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml`; `Form19` — `G49 - HISTÓRICO LINHAS MEDIÇÃO.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **ATIVIDADEEXECUTADA**, **DATAMEDICAO**, **ETAPA**, **FILIAL**, **FORNECEDOR**, **IDMEDICAO**, **IDPGTO**, **IMOVEL**, **LINHACONTRATO**, **NUMEROCONTRATO**, **OBSERVA_x00c7__x00c3_O**, **QTD**, **STATUS**, **TIPO**, **TIPOMEDICAO**, **UN**, **VALORTOTAL**, **VALORUNITARIO**.
- **Campos condicionais:** **ALTURA** — `Visible: DataCardValue366.Text="MEDIÇÃO VALOR UNITÁRIO"` / `Visible: Dropdown20_2.Selected.Value="MEDIÇÃO VALOR UNITÁRIO"`; **LARGURA** — `Visible: DataCardValue366.Text="MEDIÇÃO VALOR UNITÁRIO"` / `Visible: Dropdown20_2.Selected.Value="MEDIÇÃO VALOR UNITÁRIO"`; **QTD** — `Visible: Dropdown20_2.Selected.Value="MEDIÇÃO VALOR GLOBAL"`.
- **Campos calculados/forçados:** **FORNECEDOR** — `Update: Gallery2_42.Selected.FORNECEDOR`; **NUMEROCONTRATO** — `Update: First( Split( ComboBox11_41.Selected.Result, " - " ) ).Value`.
- **Campos gravados por Patch:** `ALTURA`, `ATIVIDADEEXECUTADA`, `DATAMEDICAO`, `DATAPGTO`, `ETAPA`, `FILIAL`, `FORNECEDOR`, `ID`, `IDMEDICAO`, `IDPGTO`, `IMOVEL`, `LARGURA`, `LINHACONTRATO`, `NUMEROCONTRATO`, `OBSERVAÇÃO`, `QTD`, `STATUS`, `TIPO`, `TIPOMEDICAO`, `UN`, `VALOR TOTAL`, `VALORUNITARIO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ATIVIDADEEXECUTADA** | `Classic/ComboBox` | `"=AddColumns( Filter( LINHACONTRATO, IDCONTRATO = First( Split( ComboBox11_41.Selected.Result, \" - \" ) ).Value ), Display, ID & \" - \" & ATIVIDADE ) "` | `["ATIVIDADE"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( EMPREITEIRO, STATUS = "ATIVO" ).FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, ThisRecord.EMPREITEIRO = "SIM" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IDMEDICAO** | `Classic/ComboBox` | `AddColumns( If( IsBlank(ComboBox11_41.Selected.Result), Filter(DESCRICAOMEDICOES,STATUS="ATIVO"), Filter( DESCRICAOMEDICOES, NUMEROCONTRATO = First( Split( ComboBox11_41.Selected.Result, " - " ) ).Value , STATUS = "ATIVO" ) ), Display, ID & " - " & FORNECEDOR )` | `["Display"]` | `não declarado` | `false` |
| **IDMEDICAO** | `Classic/ComboBox` | `DESCRICAOMEDICOES.ID` | `[""]` | `false` | `false` |
| **IDPGTO** | `Classic/ComboBox` | `AddColumns( Sort(LANCAMENTOS,ID,SortOrder.Descending), DisplayText, Text(ID) & " - " & FORNECEDOR & " - " & Text('DATA PGTO EFETUADO', "[$-pt-BR]dd/mm/yyyy") )` | `["DisplayText"]` | `não declarado` | `false` |
| **IDPGTO** | `Classic/ComboBox` | `AddColumns( Sort(LANCAMENTOS,ID,SortOrder.Descending), DisplayText, Text(ID) )` | `["ACUMULADO"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `With( { _filialSelecionada: LookUp( EMPREITEIRO, ID = Value( First( Split( ComboBox11_41.Selected.Result, " - " ) ).Value ), FILIAL ) }, AddColumns( Distinct( Filter( 'IMOVEL CADASTRADO', FILIAL = _filialSelecionada ), IMOVEL ), IMOVEL, Value ) )` | `["IMOVEL"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter('IMOVEL CADASTRADO', FILIAL = DataCardValue216_4.Selected.FILIAL), IMOVEL )` | `["Value"]` | `não declarado` | `false` |
| **LINHACONTRATO** | `Classic/ComboBox` | `"=AddColumns( Filter( LINHACONTRATO, IDCONTRATO = First( Split( ComboBox11_41.Selected.Result, \" - \" ) ).Value ), Display, ID & \" - \" & ATIVIDADE ) "` | `["Display"]` | `não declarado` | `false` |
| **LINHACONTRATO** | `Classic/ComboBox` | `AddColumns( Filter( LINHACONTRATO, IDCONTRATO=Text(ComboBox11_33.Selected.ID) ), Display, ID & " - " & ATIVIDADE )` | `["Display"]` | `não declarado` | `false` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Distinct( Filter( EMPREITEIRO, STATUS = "ATIVO" ), ID & " - " & FORNECEDOR ), Result, Text(Value) )` | `["Result"]` | `não declarado` | `false` |
| **NUMEROCONTRATO** | `Classic/ComboBox` | `AddColumns( Filter( EMPREITEIRO, STATUS = "ATIVO" ), Display, ID & " - " & FORNECEDOR )` | `["Display"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE PGTO","PAGO","ABATIDO"]` | `—` | `não declarado` | `não declarado` |
| **TIPO** | `Classic/DropDown` | `["ACRÉSCIMO","ABATIMENTO","RETENÇÃO"]` | `—` | `não declarado` | `não declarado` |
| **TIPOMEDICAO** | `Classic/DropDown` | `["MEDIÇÃO VALOR GLOBAL","MEDIÇÃO VALOR UNITÁRIO"]` | `—` | `não declarado` | `não declarado` |
| **UN** | `Classic/ComboBox` | `CADASTROUNIDADEMEDIDA` | `["ComplianceAssetId"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) têm visibilidade condicional/oculta no Power Apps, regra não descrita no contrato do portal.
- 2 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 12 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 9 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 3 campo(s) só aparecem em `Patch` (`DATAPGTO`, `ID`, `OBSERVAÇÃO`); seus defaults/regras não são executados pelo formulário genérico.

### LOCACAOPRODUTO

- **Entidade no portal:** Produtos de locação (`produtos-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 4 formulário(s), 4 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form50_2` — `DESPESAS RECORRENTES LOCAÇÃO.pa.yaml`; `EDITARGRUPO_22` — `HISTÓRICO PRODUTO.pa.yaml`; `Form50` — `PREVISTO LOCAÇÕES E IARA.pa.yaml`; `Form50_1` — `Screen1.pa.yaml`.
- **Campos visíveis:** **PRODUTO**, **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### MENSAGEM PROGRAMADA

- **Entidade no portal:** Mensagens programadas (`mensagens-programadas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 1 ocorrência(s) de `Patch`.
- **Formulários:** `Form27` — `G12- HISTÓRICO MSG.pa.yaml`.
- **Campos visíveis:** **FORNECEDOR**, **NUMEROTELEFONE**, **STATUS**, **TAREFA**.
- **Campos gravados por Patch:** `STATUS`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, StartsWith(TELEFONE, "55") )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["AGUARDANDO","EM CANCELAMENTO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### NOTASPENDENTES

- **Entidade no portal:** Notas pendentes (`notas-pendentes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 6 formulário(s), 6 chamado(s) por `SubmitForm`; 7 ocorrência(s) de `Patch`.
- **Formulários:** `Form42_7` — `F12- CADASTRO GRUPO_1.pa.yaml`; `Form42_6` — `GALERIA TICKETS.pa.yaml`; `Form42_5` — `MOVIMENTAÇÃO TICKETS.pa.yaml`; `Form42_2` — `PAGAMENTOS PREVISTOS.pa.yaml`; `Form42_4` — `RECORRENCIALOCACOES.pa.yaml`; `Form43` — `Screen10.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CONSTACNO**, **DATAPGTOEFETUADO**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **ID**, **NOTA FISCAL**, **OBS**, **OBS FISCAL**, **REGIMEAPURACAO**, **STATUS**, **VALORRETIDO**, **VALORTOTAL**.
- **Campos gravados por Patch:** `DATA PEDIDO`, `FILIAL`, `FORMAPGTO`, `FORNECEDOR`, `NOTA FISCAL`, `OBS`, `STATUS`, `VALORTOTAL`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CONSTACNO** | `Classic/DropDown` | `["SIM","DISPENSADO","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/ComboBox` | `CADASTROCONTA.CONTA` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **NOTA FISCAL** | `Classic/DropDown` | `["PENDENTE","SUBMETIDO","SUBMISSÃO DISPENSADA"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE AUDITORIA","APROVADO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE","SUBMETIDO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 3 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 1 campo(s) só aparecem em `Patch` (`DATA PEDIDO`); seus defaults/regras não são executados pelo formulário genérico.

### NOVACOTACAO

- **Entidade no portal:** Novas cotações (`novas-cotacoes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form36_1` — `G19- HISTÓRICOLOCACOES_2.pa.yaml`; `Form36` — `Screen12.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **COTACOESVINCULADAS**, **DATAFINALIZADO**, **DESCRICAO**, **ETAPA**, **FILIAL**, **FORNECEDOR**, **IDLANCAMENTO**, **ORCAMENTOESCOLHIDO**, **STATUS**.
- **Campos calculados/forçados:** **COTACOESVINCULADAS** — `Update: Concat( ComboBox48_3.SelectedItems, Text(ID), "," )`; **FORNECEDOR** — `Update: Concat( ComboBox9_4.SelectedItems, Text(CADASTRO), ";" )` / `Update: Concat( ComboBox9_3.SelectedItems, Text(CADASTRO), ";" )`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **COTACOESVINCULADAS** | `Classic/ComboBox` | `SortByColumns( AddColumns( ORCAMENTOS, EXIBICAO, Text(ID) & " - " & Coalesce(FORNECEDOR, "") & " (" & Coalesce(ETAPA, "") & ")" ), "ID", SortOrder.Descending )` | `["EXIBICAO"]` | `não declarado` | `múltipla pela fórmula` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_52.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_51.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `múltipla pela fórmula` |
| **ORCAMENTOESCOLHIDO** | `Classic/ComboBox` | `SortByColumns( AddColumns( ORCAMENTOS, EXIBICAO, Text(ID) & " - " & Coalesce(FORNECEDOR, "") & " (" & Coalesce(ETAPA, "") & ")" ), "ID", SortOrder.Descending )` | `["EXIBICAO"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE SOLICITAÇÃO","AGUARDANDO ORÇAMENTO","ORÇAMENTO RECEBIDO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 5 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- 2 campo(s) agregam múltiplas seleções; lookup/person múltiplo é deliberadamente não resolvível no formulário atual.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### ORCAMENTOS

- **Entidade no portal:** Orçamentos (`orcamentos`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form36_4` — `G19- HISTÓRICOLOCACOES_1.pa.yaml`; `Form36_2` — `Screen12_1.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ETAPA**, **FILIAL**, **FORNECEDOR**, **IDCOTACAO**, **OBS**, **STATUS**, **VALORTOTAL**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_54.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_51.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IDCOTACAO** | `Classic/ComboBox` | `SortByColumns( AddColumns( NOVACOTACAO, Display, Text(ID) & " - " & Text(FILIAL) & " (" & Text(ETAPA) & ")" ), "ID", SortOrder.Descending )` | `["Display"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE SOLICITAÇÃO","AGUARDANDO ORÇAMENTO","ORÇAMENTO RECEBIDO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 5 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### PREVLOCACOES

- **Entidade no portal:** Previsões de locação (`previsoes-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form46_1` — `PAGAMENTOS PREVISTOS.pa.yaml`; `Form46` — `PREVISTO LOCAÇÕES E IARA.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **APROVACAO**, **DATACRIACAO**, **DATAPGTOEFETUADO**, **DESCRICAO**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **PRODUTO**, **RESPONSAVELPGTO**, **STATUS**, **VALOR TOTAL**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FILIAL** | `Classic/ComboBox` | `Sort( DropColumns( GroupBy( Filter( CADASTROGRUPOIMÓVEL, STATUS = "ATIVO" ), GRUPO, tmp ), tmp ), GRUPO, SortOrder.Ascending )` | `["GRUPO"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `Distinct(Filter(CADASTROGRUPOIMÓVEL,STATUS="ATIVO"),GRUPO)` | `["Value"]` | `não declarado` | `false` |
| **FORMAPGTO** | `Classic/DropDown` | `'FORMAPGTO LOCACAO'.FORMAPGTO` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORLOCACAO.FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **PRODUTO** | `Classic/ComboBox` | `LOCACAOPRODUTO.PRODUTO` | `["PRODUTO"]` | `não declarado` | `false` |
| **RESPONSAVELPGTO** | `Classic/ComboBox` | `RESPONSAVELPGTO.FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PENDENTE PGTO","PAGAMENTO EFETUADO"]` | `—` | `não declarado` | `não declarado` |
| **STATUS** | `Classic/DropDown` | `["PAGAMENTO PREVISTO","PAGAMENTO EFETUADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### PROFISSÃO

- **Entidade no portal:** Profissões (`profissoes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_41` — `F16- CADASTRO PROFISSÃO.pa.yaml`; `EDITARGRUPO_13` — `G11- HISTÓRICO PROFISSÃO.pa.yaml`.
- **Campos visíveis:** **PROFISSÃO** (`PROFISS_x00c3_O`), **STATUS**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

### PROVISÃO PGTOS

- **Entidade no portal:** Programação de pagamentos (`provisoes-de-pagamento`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 2 ocorrência(s) de `Patch`.
- **Formulários:** `Form9` — `F3- CADASTRO PGTO PREV.pa.yaml`; `Form11` — `G28- HISTÓRICO PAG PREVISTO.pa.yaml`; `Form12` — `G28- HISTÓRICO PAG PREVISTO.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **APROVACAO**, **DATA**, **DATA PGTO EFETUADO**, **DATA PREVISTO PGTO**, **DATAEXECUCAOAGENDAMENTO**, **DATAPGTOAGENDADO**, **FILIAL**, **FORMAPGTO**, **FORNECEDOR**, **IDRECORRENCIA**, **IMOVEL**, **OBS**, **PGTOAGENDADO**, **PRODUTO**, **QTD**, **STATUS**, **VALOR TOTAL**.
- **Campos calculados/forçados:** **DATAEXECUCAOAGENDAMENTO** — `Update: DatePicker5.SelectedDate`; **DATAPGTOAGENDADO** — `Update: DatePicker1.SelectedDate`; **VALOR TOTAL** — `Update: If( IsBlank(Trim(DataCardValue285.Text)), Blank(), If( IsMatch( Trim(DataCardValue285.Text), "^\d+(,\d+)?$", MatchOptions.Complete ), Value( Trim(DataCardValue285.Text), "pt-BR" ), Blank() ) )` / `Update: If( IsBlank(Trim(DataCardValue295.Text)), Blank(), If( IsMatch( Trim(DataCardValue295.Text), "^\d+(,\d+)?$", MatchOptions.Complete ), Value( Trim(DataCardValue295.Text), "pt-BR" ), Blank() ) )`.
- **Campos gravados por Patch:** `APROVACAO`, `DATA`, `DESCRICAO`, `FILIAL`, `FORNECEDOR`, `PRODUTO`, `STATUS`, `TIPO`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **DATA** | `Classic/DropDown` | `["EMPENHADO HOJE","EMPENHADO E LIQUIDADO HOJE","LIQUIDADO HOJE","LIQUIDADO E PAGO HOJE","EMPENHADO, LIQUIDADO E PAGO HOJE","PAGO HOJE"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **FORMAPGTO** | `Classic/DropDown` | `CADASTROCONTA.CONTA` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORES.CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter( 'IMOVEL CADASTRADO', FILIAL = ComboBox65.Selected.FILIAL )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Filter( 'IMOVEL CADASTRADO', FILIAL = DataCardValue283.Selected.FILIAL )` | `["ComplianceAssetId"]` | `não declarado` | `false` |
| **PGTOAGENDADO** | `Classic/DropDown` | `["PENDENTE","PAGAMENTO AGENDADO","PAGO"]` | `—` | `não declarado` | `não declarado` |
| **PRODUTO** | `Classic/ComboBox` | `CADASTROPRODUTO.PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **PRODUTO** | `Classic/ComboBox` | `Filter( CADASTROPRODUTO, STATUS = "ATIVO", TIPO="DESPESA" ).PRODUTO` | `["field_1"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["PAGAMENTO PREVISTO","PAGAMENTO EFETUADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 3 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.
- 2 campo(s) só aparecem em `Patch` (`DESCRICAO`, `TIPO`); seus defaults/regras não são executados pelo formulário genérico.

### RECORRENTESLOCACOES

- **Entidade no portal:** Recorrências de locação (`recorrencias-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form47` — `DESPESAS RECORRENTES LOCAÇÃO.pa.yaml`; `Form47_1` — `RECORRENCIALOCACOES.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **DATAFIM**, **DATAINICIO**, **DATAPROXLANCAMENTO**, **DESCRICAO**, **FORMAPGTO**, **FORNECEDOR**, **IMOVEL**, **PRODUTO**, **RESPONSAVELPGTO**, **STATUS**, **VALOR**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **FORMAPGTO** | `Classic/DropDown` | `'FORMAPGTO LOCACAO'.FORMAPGTO` | `—` | `não declarado` | `não declarado` |
| **FORNECEDOR** | `Classic/ComboBox` | `FORNECEDORLOCACAO.FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct(Filter(CADASTROGRUPOIMÓVEL,STATUS="ATIVO"),GRUPO)` | `["Value"]` | `não declarado` | `false` |
| **IMOVEL** | `Classic/ComboBox` | `Sort( DropColumns( GroupBy( Filter( CADASTROGRUPOIMÓVEL, STATUS = "ATIVO" ), GRUPO, tmp ), tmp ), GRUPO, SortOrder.Ascending )` | `["GRUPO"]` | `não declarado` | `false` |
| **PRODUTO** | `Classic/ComboBox` | `LOCACAOPRODUTO.PRODUTO` | `["PRODUTO"]` | `não declarado` | `false` |
| **RESPONSAVELPGTO** | `Classic/ComboBox` | `RESPONSAVELPGTO.FORNECEDOR` | `["FORNECEDOR"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### RESPONSAVELPGTO

- **Entidade no portal:** Responsáveis por pagamento (`responsaveis-por-pagamento`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form48_1` — `DESPESAS RECORRENTES LOCAÇÃO.pa.yaml`; `Form48` — `PREVISTO LOCAÇÕES E IARA.pa.yaml`.
- **Campos visíveis:** **FORNECEDOR**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### SACPATOLOGIAS

- **Entidade no portal:** Patologias do SAC (`patologias-sac`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form31` — `CRIAR SACPATOLOGIA.pa.yaml`; `Form31_1` — `HISTÓRICO PATOLOGIAS.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **CLIENTE**, **CUSTO**, **DATAAPONTADO**, **DATASOLUCAO**, **DESCRICAO**, **FILIAL**, **IMOVEL**, **NUMCONTRATO**, **OBSCONCLUSAO**, **STATUS**, **TEMPO**, **TIPOPATOLOGIA**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **CLIENTE** | `Classic/ComboBox` | `Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_1.Selected.FILIAL )` | `["NOME"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |
| **IMOVEL** | `Classic/ComboBox` | `Distinct( Filter( 'CADASTRO CLIENTE_1', FILIAL = ComboBox5_1.Selected.FILIAL ), 'IMÓVEL ADQUIRIDO' )` | `["Value"]` | `não declarado` | `false` |
| **NUMCONTRATO** | `Classic/ComboBox` | `SortByColumns( AddColumns( LANCAMENTOCOMPRAS, Exibir, ID & " - " & NOME ), "IDCONTRATO", SortOrder.Ascending )` | `["Exibir"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |
| **TIPOPATOLOGIA** | `Classic/ComboBox` | `TIPOPATOLOGIA.PATOLOGIA` | `["PATOLOGIA"]` | `não declarado` | `false` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 6 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TAREFASDELEGADAS

- **Entidade no portal:** Tarefas delegadas (`tarefas-delegadas`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 9 ocorrência(s) de `Patch`.
- **Formulários:** `FORM.TAREFA_3` — `F9- CADASTRO DELEGAÇAO.pa.yaml`; `FORM.TAREFA_4` — `G9- HISTÓRICO DELEGACAO.pa.yaml`; `Form17` — `G9- HISTÓRICO DELEGACAO.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ASSOCIAÇÃO**, **CONCLUÍDO** (`CONCLU_x00cd_DO`), **DATA CONCLUSAO** (`DATACONCLUSAO0`), **DATA FATAL**, **DATA INÍCIO** (`DATAIN_x00cd_CIO`), **DATAIDENTIFICACAO**, **FILIAL**, **ID 2** (`OData__x0049_D2`), **OBSERVACOES CONCLUSAO**, **PRIORITÁRIA** (`PRIORIT_x00c1_RIA`), **PROFISSÃO** (`PROFISS_x00c3_O`), **RESPONSÁVEL** (`RESPONS_x00c1_VEL`), **TAREFA**, **TIPO**.
- **Campos calculados/forçados:** **RESPONSÁVEL** (`RESPONS_x00c1_VEL`) — `Update: If(IsBlank(ComboBox42_10.Selected.CADASTRO),TextInput4.Text,ComboBox42_10.Selected.CADASTRO)` / `Update: If(IsBlank(ComboBox42_55.Selected.CADASTRO),TextInput6.Text,ComboBox42_55.Selected.CADASTRO)`.
- **Campos gravados por Patch:** `DATA FATAL`, `PRIORITÁRIA`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ASSOCIAÇÃO** | `Classic/ComboBox` | `Distinct( Filter(CADASTROTAREFAS, TIPO = "ASSOCIAÇÃO SEDE", STATUS="ATIVO"), ASSOCIAÇÃO )` | `["Value"]` | `não declarado` | `false` |
| **ASSOCIAÇÃO** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = COMBOBOXFILIAL_4.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **DATAIDENTIFICACAO** | `Classic/DropDown` | `["ATIVIDADE C/ FATAL HOJE","ATIVIDADE C/ FATAL AMANHÃ","ATIVIDADE C/ FATAL EM 3 DIAS","ATIVIDADE C/ FATAL EM 5 DIAS","ATIVIDADE C/ FATAL EM 10 DIAS","ATIVIDADE C/ FATAL EM 30 DIAS", "ATIVIDADE SEM FATAL DEFINIDO"]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `Filter(FILIAIS,STATUS="ATIVO")` | `["Title"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/ComboBox` | `'IMOVEL CADASTRADO'.IMOVEL` | `["IMOVEL"]` | `não declarado` | `false` |
| **ID 2** (`OData__x0049_D2`) | `Classic/DropDown` | `["ATIVIDADE C/ FATAL HOJE","ATIVIDADE C/ FATAL AMANHÃ","ATIVIDADE C/ FATAL EM 3 DIAS","ATIVIDADE C/ FATAL EM 5 DIAS","ATIVIDADE C/ FATAL EM 10 DIAS","ATIVIDADE C/ FATAL EM 30 DIAS", "ATIVIDADE SEM FATAL DEFINIDO"]` | `—` | `não declarado` | `não declarado` |
| **PRIORITÁRIA** (`PRIORIT_x00c1_RIA`) | `Classic/DropDown` | `["NÃO PRIORITÁRIA","ATIVIDADE PRIORITÁRIA","ATIVIDADE EMERGENCIAL"]` | `—` | `não declarado` | `não declarado` |
| **PROFISSÃO** (`PROFISS_x00c3_O`) | `Classic/ComboBox` | `PROFISSÃO.PROFISSÃO` | `["PROFISS_x00c3_O"]` | `não declarado` | `false` |
| **RESPONSÁVEL** (`RESPONS_x00c1_VEL`) | `Classic/ComboBox` | `Filter( FORNECEDORES, STATUS = "ATIVO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **TIPO** | `Classic/DropDown` | `["DIARISTA","PRESTAÇÃO SEVIÇO VALOR GLOBAL","PRESTAÇÃO SERVIÇO POR MEDIÇÃO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TAREFASRECORRENTES

- **Entidade no portal:** Tarefas recorrentes (`tarefas-recorrentes`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form14_1` — `HISTORICOTAREFASRECORRENTES.pa.yaml`; `Form14` — `Screen11.pa.yaml`.
- **Campos visíveis:** **Anexos** (`{Attachments}`), **ASSOCIA_x00c7__x00c3_O**, **COBRAR**, **DATA**, **DATACRIARNOVAMENTE**, **DATAVENCIMENTO**, **FILIAL**, **FORNECEDOR**, **PRIORITARIA**, **RECORRENCIA**, **STATUS**, **TAREFA**.
- **Campos calculados/forçados:** **RECORRENCIA** — `Update: DataCardValue195_1.Selected` / `Update: DataCardValue195.Selected`.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ASSOCIA_x00c7__x00c3_O** | `Classic/ComboBox` | `Distinct( Filter(CADASTROTAREFAS, TIPO = "ASSOCIAÇÃO SEDE", STATUS="ATIVO"), ASSOCIAÇÃO )` | `["Value"]` | `não declarado` | `false` |
| **COBRAR** | `Classic/DropDown` | `["SIM","NÃO"]` | `—` | `não declarado` | `não declarado` |
| **DATA** | `Classic/DropDown` | `[ "VENCE HOJE", "VENCE AMANHÃ", "VENCE EM 5 DIAS", "VENCE EM 10 DIAS", "VENCE EM 20 DIAS", "VENCE EM 30 DIAS" ]` | `—` | `não declarado` | `não declarado` |
| **FILIAL** | `Classic/ComboBox` | `FILIAIS.FILIAL` | `["Title"]` | `não declarado` | `false` |
| **FORNECEDOR** | `Classic/ComboBox` | `Filter( FORNECEDORES, ( TIPO = "MÃO DE OBRA" && STATUS = "ATIVO" ) \|\| CADASTRO = "BERNARDO" ).CADASTRO` | `["Title"]` | `não declarado` | `false` |
| **PRIORITARIA** | `Classic/DropDown` | `["NÃO PRIORITÁRIA","ATIVIDADE PRIORITÁRIA","ATIVIDADE EMERGENCIAL"]` | `—` | `não declarado` | `não declarado` |
| **RECORRENCIA** | `Classic/ComboBox` | `Choices([@TAREFASRECORRENTES].RECORRENCIA)` | `["Value"]` | `não declarado` | `false` |
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) recebem cálculo, constante ou derivação Power Fx; o formulário dinâmico apenas envia o valor digitado/selecionado.
- 8 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 4 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### teste

- **Entidade no portal:** Fonte de teste legada (`fonte-teste-legada`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form1_51` — `Screen5.pa.yaml`.
- **Campos visíveis:** **{Attachments}**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TICKET MOVIMENTACOES

- **Entidade no portal:** **Sem entidade correspondente no catálogo do portal**.
- **Contrato:** ausente.
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form43_1` — `MOVIMENTAÇÃO TICKETS.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **Mensagem**, **StatusNovo**, **TicketCodigo**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **StatusNovo** | `Classic/DropDown` | `["RESPONDIDO",]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- a lista não possui entidade no catálogo; o portal genérico não oferece tela de formulário para ela.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TICKETS CLIENTES

- **Entidade no portal:** **Sem entidade correspondente no catálogo do portal**.
- **Contrato:** ausente.
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form43_2` — `GALERIA TICKETS.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **TicketCodigo**.

**Lacunas do portal:**
- a lista não possui entidade no catálogo; o portal genérico não oferece tela de formulário para ela.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TIPOHOMOLOGACAOLOCACAO

- **Entidade no portal:** Tipos de homologação de locação (`tipos-de-homologacao-de-locacao`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form39` — `Screen1.pa.yaml`; `Form39_1` — `Screen4.pa.yaml`.
- **Campos visíveis:** **TIPO**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### TIPOINCONSISTENCIA

- **Entidade no portal:** Tipos de inconsistência (`inconsistencias`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 1 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form21` — `F17- CADASTRO INCONSISTÊNCIAS.pa.yaml`.
- **Campos visíveis:** **TIPOINCONSISTENCIA3**.

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.

### TIPOMARCO

- **Entidade no portal:** Tipos de marco (`tipos-de-marco`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 3 formulário(s), 3 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form44_1` — `F44- APONTAMENTOS COMERCIAIS.pa.yaml`; `Form1_56` — `G25- HISTÓRICO TIPO MARCO.pa.yaml`; `Form44` — `I7- GERAL COMERCIAL.pa.yaml`.
- **Campos visíveis:** **{Attachments}**, **STATUS**, **TIPO**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","BLOQUEADO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- anexos aparecem dentro do formulário Power Apps, mas são filtrados como campo técnico e tratados em painel separado no portal.

### TIPOPATOLOGIA

- **Entidade no portal:** Tipos de patologia (`tipos-de-patologia`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 1 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form37_1` — `HISTÓRICO TIPO PATOLOGIA.pa.yaml`; `Form37` — `Screen13.pa.yaml`.
- **Campos visíveis:** **ETAPA**, **FILIAL**, **PATOLOGIA**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = DataCardValue221_3.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **ETAPA** | `Classic/ComboBox` | `Distinct( Filter(LANCAMENTOOBRA, FILIAL = DataCardValue221_2.Selected.FILIAL), ETAPA )` | `["Value"]` | `não declarado` | `false` |
| **FILIAL** | `Classic/DropDown` | `FILIAIS.FILIAL` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 2 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.
- 1 campo(s) definem `SearchFields/IsSearchable`; a busca genérica do portal não lê essas fórmulas nem esses campos Power Apps.

### TIPOS AUDITORIA

- **Entidade no portal:** Tipos de auditoria (`tipos-de-auditoria`).
- **Contrato:** curinga `*` (todos os campos SharePoint editáveis e não técnicos).
- **Evidência de gravação:** 2 formulário(s), 2 chamado(s) por `SubmitForm`; 0 ocorrência(s) de `Patch`.
- **Formulários:** `Form28` — `I8- GERAL AUDITORIA.pa.yaml`; `Form29` — `I8- GERAL AUDITORIA.pa.yaml`.
- **Campos visíveis:** **DATACRIAR**, **DATAFATAL**, **STATUS**, **TIPO AUDITORIA**.

| Campo fechado | Controle | Items/fonte | SearchFields | IsSearchable | Seleção |
|---|---|---|---|---|---|
| **STATUS** | `Classic/DropDown` | `["ATIVO","INATIVO"]` | `—` | `não declarado` | `não declarado` |

**Lacunas do portal:**
- o contrato usa `formFields: ["*"]`; portanto segue metadados SharePoint, não a composição exata do formulário Power Apps.
- 1 campo(s) usam `Items` literal, filtrado ou vindo de outra lista; o portal só reproduz Choice do SharePoint e lookup/person simples resolvível.

## Recomendações de implementação

1. Transformar o contrato em especificação por entidade: ordem, visibilidade, modo create/edit, read-only, default e regra de cálculo por campo. O curinga deve ser fallback de diagnóstico, não definição de produção.
2. Criar provedores de opções declarativos (`choice`, `literal`, `list`, `distinct`, `filtered-list`) e filtros dependentes entre campos, sem executar Power Fx no navegador.
3. Persistir defaults e cálculos críticos no servidor/SharePoint/Power Automate, especialmente status, aprovação, IDs de relacionamento e auditoria.
4. Adicionar ComboBox múltiplo com serialização explícita apenas para os campos que realmente usam `SelectedItems/Concat`; não inferir isso para todos os lookups.
5. Incorporar `SearchFields`, campo de exibição e `IsSearchable` ao contrato. Hoje a busca relacional do portal usa um mecanismo fixo e não equivale às pesquisas do Power Apps.
6. Manter anexos fora do payload de campos, mas posicionar o painel no mesmo fluxo de cadastro/edição e garantir vínculo transacional com o item recém-criado.
7. Implementar primeiro LANCAMENTOS, IMOVEL CADASTRADO, DOCUMENTOS_1, LINHASMEDICAO, LINHACONTRATO, NOTASPENDENTES e receitas/provisões, que concentram mais dependências e risco operacional.

